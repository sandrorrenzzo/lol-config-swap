const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Lcu, ErroApp } = require('./lcu');
const cfg = require('./configuracoes');

// Mesma pasta da v1 (console): perfis e backups são compartilhados.
const pastaDados = path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'LolConfigSwap');
const pastaPerfis = path.join(pastaDados, 'perfis');
const pastaBackups = path.join(pastaDados, 'backups');
const pastaRestaurados = path.join(pastaBackups, 'restaurados');
for (const p of [pastaPerfis, pastaBackups, pastaRestaurados]) fs.mkdirSync(p, { recursive: true });

const caminhoPerfil = (nome) => path.join(pastaPerfis, `${nome}.json`);
const caminhoBackup = (puuid) => path.join(pastaBackups, `${puuid}.json`);
const ler = (arquivo) => JSON.parse(fs.readFileSync(arquivo, 'utf8').replace(/^﻿/, ''));
const gravar = (arquivo, dados) => fs.writeFileSync(arquivo, JSON.stringify(dados, null, 2));

function validarNome(nome) {
  nome = String(nome ?? '').trim();
  if (!nome || /[<>:"/\\|?*\x00-\x1f]/.test(nome) || nome.length > 40)
    throw new ErroApp('Nome de perfil inválido. Use letras, números, - ou _.');
  return nome;
}

function listarPerfis() {
  return fs
    .readdirSync(pastaPerfis)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .map((f) => {
      try {
        const p = ler(path.join(pastaPerfis, f));
        return { nome: path.basename(f, '.json'), conta: p.conta?.nome, puuid: p.conta?.puuid, salvoEm: p.salvoEm };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

// Ícone de invocador: a URL do client exige autenticação, então vira data URL aqui.
const icones = new Map();
async function icone(lcu, id) {
  if (id == null) return null;
  if (icones.has(id)) return icones.get(id);
  try {
    const url = await new Promise((resolve, reject) => {
      const https = require('node:https');
      https
        .get(
          {
            host: '127.0.0.1',
            port: lcu.porta,
            path: `/lol-game-data/assets/v1/profile-icons/${id}.jpg`,
            headers: { Authorization: lcu.auth },
            rejectUnauthorized: false,
          },
          (res) => {
            const pedacos = [];
            res.on('data', (c) => pedacos.push(c));
            res.on('end', () =>
              res.statusCode === 200 ? resolve('data:image/jpeg;base64,' + Buffer.concat(pedacos).toString('base64')) : reject(),
            );
          },
        )
        .on('error', reject);
    });
    icones.set(id, url);
    return url;
  } catch {
    return null;
  }
}

async function estado() {
  const base = { perfis: listarPerfis(), pastaDados };
  const lcu = Lcu.conectar();
  if (!lcu) return { ...base, client: 'fechado' };

  try {
    const conta = await cfg.contaAtual(lcu);
    const fase = await cfg.fase(lcu);
    const arquivoBackup = caminhoBackup(conta.puuid);
    let backup = null;
    if (fs.existsSync(arquivoBackup)) {
      const b = ler(arquivoBackup);
      backup = { salvoEm: b.salvoEm, perfilAplicado: b.perfilAplicado ?? null };
    }
    return {
      ...base,
      client: 'ok',
      conta: { ...conta, icone: await icone(lcu, conta.iconeId) },
      fase,
      emPartida: cfg.emPartida(fase),
      backup,
    };
  } catch {
    // Client aberto, mas ainda sem login (ou carregando).
    return { ...base, client: 'sem-conta' };
  }
}

function exigirLcu() {
  const lcu = Lcu.conectar();
  if (!lcu) throw new ErroApp('Client do LoL não está aberto. Abra o client e faça login.');
  return lcu;
}

async function salvar(nome) {
  nome = validarNome(nome);
  const lcu = exigirLcu();
  const conta = await cfg.contaAtual(lcu);
  if (fs.existsSync(caminhoBackup(conta.puuid)))
    throw new ErroApp(`${conta.nome} está com um perfil aplicado. Restaure antes de salvar um perfil desta conta.`);

  const snapshot = await cfg.capturar(lcu);
  gravar(caminhoPerfil(nome), snapshot);
  return `Perfil "${nome}" salvo a partir de ${conta.nome}.`;
}

async function aplicarPerfil(nome) {
  nome = validarNome(nome);
  const arquivo = caminhoPerfil(nome);
  if (!fs.existsSync(arquivo)) throw new ErroApp(`Perfil "${nome}" não existe.`);
  const perfil = ler(arquivo);

  const lcu = exigirLcu();
  await cfg.garantirForaDePartida(lcu);
  const conta = await cfg.contaAtual(lcu);
  if (perfil.conta?.puuid === conta.puuid) throw new ErroApp(`O perfil "${nome}" é desta própria conta.`);

  // Nunca sobrescrever um backup existente: ele guarda as configs originais da conta.
  const arquivoBackup = caminhoBackup(conta.puuid);
  if (fs.existsSync(arquivoBackup)) {
    const b = ler(arquivoBackup);
    b.perfilAplicado = nome;
    gravar(arquivoBackup, b);
  } else {
    // Captura também as categorias do perfil, para a restauração desfazer tudo que for alterado.
    const original = await cfg.capturar(lcu, cfg.categoriasDe(perfil));
    original.perfilAplicado = nome;
    gravar(arquivoBackup, original);
  }

  const falhas = await cfg.aplicar(lcu, perfil);
  return mensagemComFalhas(`Perfil "${nome}" aplicado em ${conta.nome}. Restaure ao terminar de jogar.`, falhas);
}

async function restaurar() {
  const lcu = exigirLcu();
  await cfg.garantirForaDePartida(lcu);
  const conta = await cfg.contaAtual(lcu);

  const arquivoBackup = caminhoBackup(conta.puuid);
  if (!fs.existsSync(arquivoBackup)) throw new ErroApp(`Não há backup para ${conta.nome}.`);

  const falhas = await cfg.aplicar(lcu, ler(arquivoBackup));

  // Arquiva o backup usado, para o próximo "aplicar" criar um novo.
  const carimbo = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  fs.renameSync(arquivoBackup, path.join(pastaRestaurados, `${conta.puuid}_${carimbo}.json`));
  return mensagemComFalhas(`Configs originais de ${conta.nome} restauradas.`, falhas);
}

function excluirPerfil(nome) {
  nome = validarNome(nome);
  const arquivo = caminhoPerfil(nome);
  if (fs.existsSync(arquivo)) fs.unlinkSync(arquivo);
  return `Perfil "${nome}" excluído.`;
}

function mensagemComFalhas(msg, falhas) {
  return falhas.length ? `${msg} Aviso: ${falhas.length} categoria(s) do client não foram gravadas.` : msg;
}

// Uma operação por vez: evita aplicar e restaurar ao mesmo tempo.
let ocupado = false;
function acao(fn) {
  return async (_evento, ...args) => {
    if (ocupado) return { ok: false, mensagem: 'Aguarde a operação anterior terminar.' };
    ocupado = true;
    try {
      return { ok: true, mensagem: await fn(...args) };
    } catch (e) {
      return { ok: false, mensagem: e instanceof ErroApp ? e.message : `Erro inesperado: ${e.message}` };
    } finally {
      ocupado = false;
    }
  };
}

ipcMain.handle('estado', () => estado());
ipcMain.handle('salvar', acao(salvar));
ipcMain.handle('aplicar', acao(aplicarPerfil));
ipcMain.handle('restaurar', acao(restaurar));
ipcMain.handle('excluir', acao(excluirPerfil));
ipcMain.handle('abrir-pasta', () => shell.openPath(pastaDados));
ipcMain.handle('versao', () => app.getVersion());

function criarJanela() {
  const janela = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 420,
    minHeight: 560,
    backgroundColor: '#0b1016',
    title: 'LoL Config Swap',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  janela.setMenu(null);
  janela.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

app.whenReady().then(criarJanela);
app.on('window-all-closed', () => app.quit());
