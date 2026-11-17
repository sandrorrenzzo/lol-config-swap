using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace LolConfigSwap;

/// <summary>Cliente da API local do client do LoL (LCU).</summary>
sealed class Lcu : IDisposable
{
    readonly HttpClient _http;

    public string PastaLol { get; }

    Lcu(HttpClient http, string pastaLol)
    {
        _http = http;
        PastaLol = pastaLol;
    }

    public static Lcu Conectar()
    {
        var pasta = AcharPastaLol();
        var lockfile = Path.Combine(pasta, "lockfile");
        if (!File.Exists(lockfile))
            throw new ErroApp($"Client do LoL não está aberto (sem lockfile em \"{pasta}\"). Abra o client e faça login.");

        // O client mantém o lockfile aberto; é preciso compartilhar a leitura.
        string conteudo;
        using (var fs = new FileStream(lockfile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
        using (var sr = new StreamReader(fs))
            conteudo = sr.ReadToEnd();

        // Formato: nome:pid:porta:senha:protocolo
        var partes = conteudo.Split(':');
        if (partes.Length < 5)
            throw new ErroApp("lockfile em formato inesperado.");

        var handler = new HttpClientHandler
        {
            // O client usa certificado próprio da Riot em 127.0.0.1.
            ServerCertificateCustomValidationCallback = (_, _, _, _) => true,
        };
        var http = new HttpClient(handler)
        {
            BaseAddress = new Uri($"https://127.0.0.1:{partes[2]}"),
            Timeout = TimeSpan.FromSeconds(20),
        };
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Basic", Convert.ToBase64String(Encoding.ASCII.GetBytes("riot:" + partes[3])));

        return new Lcu(http, pasta);
    }

    static string AcharPastaLol()
    {
        var env = Environment.GetEnvironmentVariable("LOL_PATH");
        if (!string.IsNullOrWhiteSpace(env))
            return env;

        foreach (var proc in Process.GetProcessesByName("LeagueClientUx"))
        {
            try
            {
                var dir = Path.GetDirectoryName(proc.MainModule?.FileName);
                if (dir != null)
                    return dir;
            }
            catch
            {
                // Sem acesso ao processo: cai no caminho padrão.
            }
        }

        return @"C:\Riot Games\League of Legends";
    }

    public async Task<JsonNode?> Get(string caminho)
    {
        using var resp = await _http.GetAsync(caminho);
        var corpo = await resp.Content.ReadAsStringAsync();
        if (!resp.IsSuccessStatusCode)
            throw new ErroApp($"GET {caminho} falhou ({(int)resp.StatusCode}): {corpo}");
        return string.IsNullOrWhiteSpace(corpo) ? null : JsonNode.Parse(corpo);
    }

    public async Task Enviar(HttpMethod metodo, string caminho, JsonNode? corpo = null)
    {
        using var req = new HttpRequestMessage(metodo, caminho);
        if (corpo != null)
            req.Content = new StringContent(corpo.ToJsonString(), Encoding.UTF8, "application/json");

        using var resp = await _http.SendAsync(req);
        if (!resp.IsSuccessStatusCode)
        {
            var erro = await resp.Content.ReadAsStringAsync();
            throw new ErroApp($"{metodo} {caminho} falhou ({(int)resp.StatusCode}): {erro}");
        }
    }

    public void Dispose() => _http.Dispose();
}

sealed class ErroApp(string mensagem) : Exception(mensagem);
