using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace LolConfigSwap;

/// <summary>Lê e grava o conjunto completo de configurações de uma conta.</summary>
static partial class Configuracoes
{
    const string GameSettings = "/lol-game-settings/v1/game-settings";
    const string InputSettings = "/lol-game-settings/v1/input-settings";
    const string ClientConta = "/lol-settings/v1/account/";

    // Fases em que o jogo está aberto: ele lê as configs no início e grava as dele ao fechar.
    static readonly string[] FasesBloqueadas = ["GameStart", "InProgress", "Reconnect", "PreEndOfGame", "WaitingForStats"];

    public record Conta(string Nome, string Puuid);

    public static async Task<Conta> ContaAtual(Lcu lcu)
    {
        var s = await lcu.Get("/lol-summoner/v1/current-summoner")
            ?? throw new ErroApp("Nenhuma conta logada no client.");
        var puuid = s["puuid"]?.GetValue<string>();
        if (string.IsNullOrEmpty(puuid))
            throw new ErroApp("Nenhuma conta logada no client.");
        return new Conta($"{s["gameName"]}#{s["tagLine"]}", puuid);
    }

    public static async Task<string> Fase(Lcu lcu) =>
        (await lcu.Get("/lol-gameflow/v1/gameflow-phase"))?.GetValue<string>() ?? "None";

    public static async Task GarantirForaDePartida(Lcu lcu)
    {
        var fase = await Fase(lcu);
        if (FasesBloqueadas.Contains(fase))
            throw new ErroApp($"Partida em andamento (fase: {fase}). Rode o comando depois que a partida terminar.");
    }

    /// <summary>
    /// Categorias de configuração do client salvas na conta. O client não expõe uma lista,
    /// então elas vêm do cache local da conta logada (LCUAccountPreferences.yaml).
    /// </summary>
    public static IEnumerable<string> CategoriasDoClient(Lcu lcu)
    {
        var arquivo = Path.Combine(lcu.PastaLol, "Config", "LCUAccountPreferences.yaml");
        if (!File.Exists(arquivo))
            return [];

        using var fs = new FileStream(arquivo, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var sr = new StreamReader(fs);
        return ChaveDeTopo().Matches(sr.ReadToEnd()).Select(m => m.Groups[1].Value).ToList();
    }

    [GeneratedRegex(@"^([A-Za-z0-9_\-]+):\s*$", RegexOptions.Multiline)]
    private static partial Regex ChaveDeTopo();

    /// <summary>Captura jogo (game + input) e todas as categorias de client da conta logada.</summary>
    public static async Task<JsonObject> Capturar(Lcu lcu, IEnumerable<string>? categoriasExtras = null)
    {
        var conta = await ContaAtual(lcu);

        var client = new JsonObject();
        var categorias = CategoriasDoClient(lcu)
            .Concat(categoriasExtras ?? [])
            .Distinct()
            .Order(StringComparer.Ordinal);

        foreach (var cat in categorias)
            client[cat] = await lcu.Get(ClientConta + Uri.EscapeDataString(cat));

        return new JsonObject
        {
            ["conta"] = new JsonObject { ["nome"] = conta.Nome, ["puuid"] = conta.Puuid },
            ["salvoEm"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"),
            ["jogo"] = new JsonObject
            {
                ["game-settings"] = await lcu.Get(GameSettings),
                ["input-settings"] = await lcu.Get(InputSettings),
            },
            ["client"] = client,
        };
    }

    /// <summary>Aplica um snapshot na conta logada. Retorna as categorias que falharam.</summary>
    public static async Task<List<string>> Aplicar(Lcu lcu, JsonObject snapshot)
    {
        var falhas = new List<string>();
        var jogo = snapshot["jogo"]?.AsObject() ?? throw new ErroApp("Arquivo sem a seção \"jogo\".");

        await lcu.Enviar(HttpMethod.Patch, GameSettings, jogo["game-settings"]?.DeepClone());
        await lcu.Enviar(HttpMethod.Patch, InputSettings, jogo["input-settings"]?.DeepClone());
        await lcu.Enviar(HttpMethod.Post, "/lol-game-settings/v1/save");

        foreach (var (cat, valor) in snapshot["client"]?.AsObject() ?? [])
        {
            if (valor is null)
                continue;
            try
            {
                await lcu.Enviar(HttpMethod.Put, ClientConta + Uri.EscapeDataString(cat), valor.DeepClone());
            }
            catch (ErroApp)
            {
                falhas.Add(cat);
            }
        }

        await lcu.Enviar(HttpMethod.Post, "/lol-settings/v1/account/save");
        return falhas;
    }

    public static IEnumerable<string> CategoriasDe(JsonObject snapshot) =>
        snapshot["client"]?.AsObject().Select(kv => kv.Key) ?? [];
}
