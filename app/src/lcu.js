// Cliente da API local do client do LoL (LCU).
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

class ErroApp extends Error {}

// O client usa certificado próprio da Riot em 127.0.0.1.
const agente = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

let pastaEmCache = null;

function acharPastaLol() {
  if (process.env.LOL_PATH) return process.env.LOL_PATH;
  if (pastaEmCache && fs.existsSync(path.join(pastaEmCache, 'lockfile'))) return pastaEmCache;

  const padrao = 'C:\\Riot Games\\League of Legends';
  if (fs.existsSync(path.join(padrao, 'lockfile'))) return (pastaEmCache = padrao);

  // Instalação fora do padrão: pega a pasta do processo do client.
  try {
    const exe = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', '(Get-Process LeagueClientUx -ErrorAction SilentlyContinue | Select-Object -First 1).Path'],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 },
    ).trim();
    if (exe) return (pastaEmCache = path.dirname(exe));
  } catch {
    // Sem PowerShell ou sem acesso: cai no padrão.
  }
  return padrao;
}

class Lcu {
  constructor(pastaLol, porta, senha) {
    this.pastaLol = pastaLol;
    this.porta = porta;
    this.auth = 'Basic ' + Buffer.from('riot:' + senha).toString('base64');
  }

  /** Retorna null se o client não estiver aberto. */
  static conectar() {
    const pasta = acharPastaLol();
    let conteudo;
    try {
      conteudo = fs.readFileSync(path.join(pasta, 'lockfile'), 'utf8');
    } catch {
      return null;
    }
    // Formato: nome:pid:porta:senha:protocolo
    const partes = conteudo.split(':');
    if (partes.length < 5) return null;
    return new Lcu(pasta, Number(partes[2]), partes[3]);
  }

  requisicao(metodo, caminho, corpo) {
    const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: '127.0.0.1',
          port: this.porta,
          path: caminho,
          method: metodo,
          agent: agente,
          timeout: 20000,
          headers: {
            Authorization: this.auth,
            Accept: 'application/json',
            ...(dados ? { 'Content-Type': 'application/json', 'Content-Length': dados.length } : {}),
          },
        },
        (res) => {
          const pedacos = [];
          res.on('data', (c) => pedacos.push(c));
          res.on('end', () => {
            const texto = Buffer.concat(pedacos).toString('utf8');
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(new ErroApp(`${metodo} ${caminho} falhou (${res.statusCode}): ${texto}`));
              return;
            }
            resolve(texto.trim() ? JSON.parse(texto) : null);
          });
        },
      );
      req.on('timeout', () => req.destroy(new ErroApp(`${metodo} ${caminho}: tempo esgotado`)));
      req.on('error', (e) => reject(e instanceof ErroApp ? e : new ErroApp(`Não consegui falar com o client do LoL (${e.message}).`)));
      if (dados) req.write(dados);
      req.end();
    });
  }

  get(caminho) {
    return this.requisicao('GET', caminho);
  }

  enviar(metodo, caminho, corpo) {
    return this.requisicao(metodo, caminho, corpo);
  }
}

module.exports = { Lcu, ErroApp };
