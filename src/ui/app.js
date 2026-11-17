const $ = (id) => document.getElementById(id);

let estado = null;
let ocupado = false;

function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const f of filhos.flat()) if (f != null) n.append(f);
  return n;
}

function renderConta() {
  const alvo = $('conta');
  alvo.replaceChildren();

  if (estado.client === 'fechado' || estado.client === 'sem-conta') {
    const texto = estado.client === 'fechado' ? 'Abra o client do LoL e faça login…' : 'Client aberto. Aguardando login…';
    alvo.append(el('div', { class: 'procurando' }, el('span', { class: 'pulso', 'aria-hidden': 'true' }), texto));
    return;
  }

  const c = estado.conta;
  const pilula = estado.backup
    ? el('span', { class: 'pilula aplicado' }, 'Perfil aplicado')
    : el('span', { class: 'pilula propria' }, 'Configs próprias');

  alvo.append(
    c.icone ? el('img', { class: 'avatar', src: c.icone, alt: '' }) : el('div', { class: 'avatar' }),
    el(
      'div',
      { class: 'conta-info' },
      el('div', { class: 'conta-nome', title: c.nome }, c.nome),
      el('div', { class: 'conta-sub' }, `Nível ${c.nivel ?? '?'}`),
    ),
    pilula,
  );
}

function renderAviso() {
  const alvo = $('aviso');
  alvo.replaceChildren();
  alvo.hidden = true;
  if (estado.client !== 'ok') return;

  if (estado.emPartida) {
    alvo.hidden = false;
    alvo.append(
      el(
        'div',
        { class: 'aviso partida' },
        el('p', {}, el('strong', {}, 'Partida em andamento.'), el('small', {}, 'Aplicar e restaurar voltam a funcionar quando a partida terminar.')),
      ),
    );
    return;
  }

  if (estado.backup) {
    const qual = estado.backup.perfilAplicado ? `O perfil "${estado.backup.perfilAplicado}" está` : 'Um perfil está';
    alvo.hidden = false;
    alvo.append(
      el(
        'div',
        { class: 'aviso aplicado' },
        el(
          'p',
          {},
          el('strong', {}, `${qual} aplicado nesta conta.`),
          el('small', {}, `Configs originais salvas em ${estado.backup.salvoEm}. Restaure ao terminar de jogar.`),
        ),
        el('button', { class: 'btn alerta', type: 'button', disabled: ocupado, onclick: restaurar }, 'Restaurar'),
      ),
    );
  }
}

function renderPerfis() {
  const lista = $('perfis');
  lista.replaceChildren();

  if (estado.perfis.length === 0) {
    lista.append(el('li', { class: 'vazio' }, 'Nenhum perfil ainda. Logue na sua conta e salve um perfil abaixo.'));
    return;
  }

  const logado = estado.client === 'ok';
  for (const p of estado.perfis) {
    const daContaAtual = logado && p.puuid === estado.conta.puuid;
    let motivo = null;
    if (!logado) motivo = 'Faça login no client';
    else if (estado.emPartida) motivo = 'Partida em andamento';
    else if (daContaAtual) motivo = 'Este perfil é desta conta';

    lista.append(
      el(
        'li',
        { class: 'perfil' },
        el(
          'div',
          { class: 'perfil-info' },
          el('div', { class: 'perfil-nome' }, p.nome),
          el('div', { class: 'perfil-sub' }, `${p.conta ?? 'conta desconhecida'} · salvo em ${p.salvoEm ?? '?'}`),
        ),
        el(
          'button',
          { class: 'btn primario', type: 'button', disabled: ocupado || !!motivo, title: motivo ?? `Aplicar "${p.nome}" nesta conta`, onclick: () => aplicar(p.nome) },
          'Aplicar',
        ),
        el(
          'button',
          { class: 'btn icone', type: 'button', disabled: ocupado, title: `Excluir "${p.nome}"`, 'aria-label': `Excluir perfil ${p.nome}`, onclick: () => excluir(p.nome) },
          '✕',
        ),
      ),
    );
  }
}

function renderSalvar() {
  const bloqueado = ocupado || estado.client !== 'ok' || !!estado.backup;
  $('btn-salvar').disabled = bloqueado;
  $('btn-salvar').title =
    estado.client !== 'ok' ? 'Faça login no client' : estado.backup ? 'Restaure esta conta antes de salvar um perfil dela' : '';
}

function render() {
  if (!estado) return;
  document.body.classList.toggle('ocupado', ocupado);
  renderConta();
  renderAviso();
  renderPerfis();
  renderSalvar();
}

let timerToast;
function toast(mensagem, ok) {
  const t = $('toast');
  t.textContent = mensagem;
  t.className = `toast ${ok ? 'ok' : 'erro'}`;
  t.hidden = false;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => (t.hidden = true), ok ? 4500 : 8000);
}

async function atualizar() {
  if (ocupado) return;
  try {
    estado = await window.api.estado();
    render();
  } catch {
    // Mantém a última tela; tenta de novo no próximo ciclo.
  }
}

async function executar(fn) {
  if (ocupado) return;
  ocupado = true;
  render();
  try {
    const r = await fn();
    toast(r.mensagem, r.ok);
    return r;
  } finally {
    ocupado = false;
    await atualizar();
  }
}

const aplicar = (nome) => executar(() => window.api.aplicar(nome));
const restaurar = () => executar(() => window.api.restaurar());

function excluir(nome) {
  if (!confirm(`Excluir o perfil "${nome}"? Isso não afeta nenhuma conta.`)) return;
  executar(() => window.api.excluir(nome));
}

$('form-salvar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome = $('nome').value.trim();
  if (!nome) {
    $('nome').focus();
    return;
  }
  const r = await executar(() => window.api.salvar(nome));
  if (r?.ok) $('nome').value = '';
});

$('abrir-pasta').addEventListener('click', () => window.api.abrirPasta());
window.api.versao().then((v) => ($('versao').textContent = `v${v}`));

atualizar();
setInterval(atualizar, 2500);
