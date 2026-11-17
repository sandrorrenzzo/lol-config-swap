// Lê e grava o conjunto completo de configurações de uma conta.
// Mesmo formato de arquivo da v1 (console), então perfis e backups são compatíveis.
const fs = require('node:fs');
const path = require('node:path');
const { ErroApp } = require('./lcu');

const GAME_SETTINGS = '/lol-game-settings/v1/game-settings';
const INPUT_SETTINGS = '/lol-game-settings/v1/input-settings';
const CLIENT_CONTA = '/lol-settings/v1/account/';

// Fases em que o jogo está aberto: ele lê as configs no início e grava as dele ao fechar.
const FASES_BLOQUEADAS = ['GameStart', 'InProgress', 'Reconnect', 'PreEndOfGame', 'WaitingForStats'];

async function contaAtual(lcu) {
  const s = await lcu.get('/lol-summoner/v1/current-summoner');
  if (!s || !s.puuid) throw new ErroApp('Nenhuma conta logada no client.');
  return { nome: `${s.gameName}#${s.tagLine}`, puuid: s.puuid, iconeId: s.profileIconId, nivel: s.summonerLevel };
}

async function fase(lcu) {
  return (await lcu.get('/lol-gameflow/v1/gameflow-phase')) || 'None';
}

const emPartida = (f) => FASES_BLOQUEADAS.includes(f);

async function garantirForaDePartida(lcu) {
  const f = await fase(lcu);
  if (emPartida(f)) throw new ErroApp(`Partida em andamento (${f}). Tente de novo quando a partida terminar.`);
}

/**
 * Categorias de configuração do client salvas na conta. O client não expõe uma lista,
 * então elas vêm do cache local da conta logada (LCUAccountPreferences.yaml).
 */
function categoriasDoClient(lcu) {
  try {
    const texto = fs.readFileSync(path.join(lcu.pastaLol, 'Config', 'LCUAccountPreferences.yaml'), 'utf8');
    return [...texto.matchAll(/^([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
  } catch {
    return [];
  }
}

function agora() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Captura jogo (game + input) e todas as categorias de client da conta logada. */
async function capturar(lcu, categoriasExtras = []) {
  const conta = await contaAtual(lcu);
  const categorias = [...new Set([...categoriasDoClient(lcu), ...categoriasExtras])].sort();

  const client = {};
  for (const cat of categorias) client[cat] = await lcu.get(CLIENT_CONTA + encodeURIComponent(cat));

  return {
    conta: { nome: conta.nome, puuid: conta.puuid },
    salvoEm: agora(),
    jogo: {
      'game-settings': await lcu.get(GAME_SETTINGS),
      'input-settings': await lcu.get(INPUT_SETTINGS),
    },
    client,
  };
}

/** Aplica um snapshot na conta logada. Retorna as categorias que falharam. */
async function aplicar(lcu, snapshot) {
  if (!snapshot.jogo) throw new ErroApp('Arquivo sem a seção "jogo".');

  await lcu.enviar('PATCH', GAME_SETTINGS, snapshot.jogo['game-settings']);
  await lcu.enviar('PATCH', INPUT_SETTINGS, snapshot.jogo['input-settings']);
  await lcu.enviar('POST', '/lol-game-settings/v1/save');

  const falhas = [];
  for (const [cat, valor] of Object.entries(snapshot.client || {})) {
    if (valor == null) continue;
    try {
      await lcu.enviar('PUT', CLIENT_CONTA + encodeURIComponent(cat), valor);
    } catch {
      falhas.push(cat);
    }
  }

  await lcu.enviar('POST', '/lol-settings/v1/account/save');
  return falhas;
}

const categoriasDe = (snapshot) => Object.keys(snapshot.client || {});

module.exports = { contaAtual, fase, emPartida, garantirForaDePartida, capturar, aplicar, categoriasDe };
