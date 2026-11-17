using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using LolConfigSwap;

Console.OutputEncoding = Encoding.UTF8;

var pastaDados = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LolConfigSwap");
var pastaPerfis = Path.Combine(pastaDados, "perfis");
var pastaBackups = Path.Combine(pastaDados, "backups");
var pastaRestaurados = Path.Combine(pastaBackups, "restaurados");
foreach (var p in new[] { pastaPerfis, pastaBackups, pastaRestaurados })
    Directory.CreateDirectory(p);

var json = new JsonSerializerOptions { WriteIndented = true };

if (args.Length > 0)
    return await Executar(args);

// Sem argumentos: menu interativo.
while (true)
{
    Console.WriteLine();
    Console.WriteLine("=== LoL Config Swap ===");
    Console.WriteLine("1) Status");
    Console.WriteLine("2) Salvar a config da conta logada como perfil (rode na SUA conta)");
    Console.WriteLine("3) Aplicar um perfil nesta conta (faz backup antes)");
    Console.WriteLine("4) Restaurar o backup desta conta");
    Console.WriteLine("5) Listar perfis");
    Console.WriteLine("0) Sair");
    Console.Write("> ");

    var opcao = Console.ReadLine()?.Trim();
    string[]? cmd = opcao switch
    {
        "1" => ["status"],
        "2" => ["salvar", Perguntar("Nome do perfil (ex.: sandro): ")],
        "3" => ["aplicar", Perguntar("Nome do perfil a aplicar: ")],
        "4" => ["restaurar"],
        "5" => ["perfis"],
        "0" or null => null,
        _ => [],
    };
    if (cmd is null)
        return 0;
    if (cmd.Length > 0)
        await Executar(cmd);
}

async Task<int> Executar(string[] a)
{
    try
    {
        switch (a[0].ToLowerInvariant())
        {
            case "status": await Status(); break;
            case "perfis": ListarPerfis(); break;
            case "salvar": await Salvar(Nome(a)); break;
            case "aplicar": await AplicarPerfil(Nome(a)); break;
            case "restaurar": await Restaurar(); break;
            default:
                Console.WriteLine("Comandos: status | perfis | salvar <nome> | aplicar <nome> | restaurar");
                return 2;
        }
        return 0;
    }
    catch (ErroApp e)
    {
        Console.WriteLine($"ERRO: {e.Message}");
        return 1;
    }
    catch (HttpRequestException e)
    {
        Console.WriteLine($"ERRO: não consegui falar com o client do LoL ({e.Message}). Ele está aberto?");
        return 1;
    }
}

async Task Status()
{
    using var lcu = Lcu.Conectar();
    var conta = await Configuracoes.ContaAtual(lcu);
    Console.WriteLine($"Conta logada : {conta.Nome}");
    Console.WriteLine($"Fase         : {await Configuracoes.Fase(lcu)}");
    var backup = CaminhoBackup(conta.Puuid);
    Console.WriteLine(File.Exists(backup)
        ? $"Backup       : EXISTE (salvo em {Ler(backup)["salvoEm"]}) -> use 'restaurar' ao terminar"
        : "Backup       : nenhum (a conta está com as próprias configs)");
    Console.WriteLine($"Dados em     : {pastaDados}");
}

void ListarPerfis()
{
    var arquivos = Directory.GetFiles(pastaPerfis, "*.json");
    if (arquivos.Length == 0)
    {
        Console.WriteLine("Nenhum perfil. Logue na sua conta e use 'salvar <nome>'.");
        return;
    }
    foreach (var f in arquivos)
    {
        var p = Ler(f);
        Console.WriteLine($"- {Path.GetFileNameWithoutExtension(f)}  (conta {p["conta"]?["nome"]}, salvo em {p["salvoEm"]})");
    }
}

async Task Salvar(string nome)
{
    using var lcu = Lcu.Conectar();
    var conta = await Configuracoes.ContaAtual(lcu);
    if (File.Exists(CaminhoBackup(conta.Puuid)))
        throw new ErroApp($"A conta {conta.Nome} está com um perfil aplicado. Rode 'restaurar' antes de salvar um perfil dela.");

    var snapshot = await Configuracoes.Capturar(lcu);
    var destino = CaminhoPerfil(nome);
    Gravar(destino, snapshot);
    Console.WriteLine($"OK: perfil '{nome}' salvo a partir de {conta.Nome} ({Configuracoes.CategoriasDe(snapshot).Count()} categorias do client + jogo).");
    Console.WriteLine($"    {destino}");
}

async Task AplicarPerfil(string nome)
{
    var arquivoPerfil = CaminhoPerfil(nome);
    if (!File.Exists(arquivoPerfil))
        throw new ErroApp($"Perfil '{nome}' não existe. Use 'perfis' para listar.");
    var perfil = Ler(arquivoPerfil);

    using var lcu = Lcu.Conectar();
    await Configuracoes.GarantirForaDePartida(lcu);
    var conta = await Configuracoes.ContaAtual(lcu);

    if (perfil["conta"]?["puuid"]?.GetValue<string>() == conta.Puuid)
        throw new ErroApp($"O perfil '{nome}' é desta própria conta ({conta.Nome}). Nada a fazer.");

    // Nunca sobrescrever um backup existente: ele guarda as configs originais da conta.
    var backup = CaminhoBackup(conta.Puuid);
    if (File.Exists(backup))
    {
        Console.WriteLine($"Backup de {conta.Nome} já existe (de {Ler(backup)["salvoEm"]}). Mantido sem alterar.");
    }
    else
    {
        // Captura também as categorias do perfil, para a restauração desfazer tudo que for alterado.
        var original = await Configuracoes.Capturar(lcu, Configuracoes.CategoriasDe(perfil));
        Gravar(backup, original);
        Console.WriteLine($"Backup das configs de {conta.Nome} salvo.");
    }

    var falhas = await Configuracoes.Aplicar(lcu, perfil);
    Console.WriteLine($"OK: perfil '{nome}' aplicado em {conta.Nome}. Ao terminar de jogar, rode 'restaurar'.");
    AvisarFalhas(falhas);
}

async Task Restaurar()
{
    using var lcu = Lcu.Conectar();
    await Configuracoes.GarantirForaDePartida(lcu);
    var conta = await Configuracoes.ContaAtual(lcu);

    var backup = CaminhoBackup(conta.Puuid);
    if (!File.Exists(backup))
        throw new ErroApp($"Não há backup para {conta.Nome}. A conta já está com as próprias configs.");

    var falhas = await Configuracoes.Aplicar(lcu, Ler(backup));

    // Arquiva o backup usado, para o próximo 'aplicar' criar um novo.
    File.Move(backup, Path.Combine(pastaRestaurados, $"{conta.Puuid}_{DateTime.Now:yyyyMMdd-HHmmss}.json"));
    Console.WriteLine($"OK: configs originais de {conta.Nome} restauradas.");
    AvisarFalhas(falhas);
}

void AvisarFalhas(List<string> falhas)
{
    if (falhas.Count > 0)
        Console.WriteLine($"Aviso: {falhas.Count} categoria(s) do client não aceitaram a gravação: {string.Join(", ", falhas)}");
}

string Nome(string[] a)
{
    var nome = a.Length > 1 ? a[1].Trim() : "";
    if (nome.Length == 0 || nome.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        throw new ErroApp("Informe um nome de perfil válido (ex.: sandro).");
    return nome;
}

static string Perguntar(string texto)
{
    Console.Write(texto);
    return Console.ReadLine()?.Trim() ?? "";
}

string CaminhoPerfil(string nome) => Path.Combine(pastaPerfis, nome + ".json");
string CaminhoBackup(string puuid) => Path.Combine(pastaBackups, puuid + ".json");
JsonObject Ler(string caminho) => JsonNode.Parse(File.ReadAllText(caminho))!.AsObject();
void Gravar(string caminho, JsonObject dados) => File.WriteAllText(caminho, dados.ToJsonString(json));
