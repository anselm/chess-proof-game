import { Board, WHITE, BLACK, typeOf, colorOf, SQ, fileOf, rankOf, sqName } from '../src/engine.js';
import { audit } from '../src/analysis.js';

const GLYPH = { 'K':'♚','Q':'♛','R':'♜','B':'♝','N':'♞','P':'♟','k':'♚','q':'♛','r':'♜','b':'♝','n':'♞','p':'♟' };
const ORDER = ['K','Q','R','B','N','P','k','q','r','b','n','p'];
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - -';
const EXAMPLES = [
  ['the reddit "mate in 2"', 'R7/R5pk/1p6/1p4PP/1p6/1p6/1P6/K7 w - -'],
  ['a 4-move game', 'rnbqkbnr/ppp1pppp/8/3p4/4P3/5N2/PPPP1PPP/RNBQKB1R b - -'],
  ['impossible: an extra bishop', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBBR w - -'],
  ['impossible: pawn structure', 'rnbqkbnr/pppppppp/8/8/8/8/1PPPPPPP/RNBQKBNR w - -'],
  ['impossible: too many captures', '4k3/8/8/8/8/8/PPPPPPPP/RNBQKBNR w - -'],
];

let board = new Array(64).fill(''), turn = 'w', flipped = false, sel = 'P', worker = null, moves = null;

const $ = (s) => document.querySelector(s);
const idx = (f, r) => r * 8 + f;

function render() {
  const el = $('#board');
  el.innerHTML = '';
  for (let vr = 7; vr >= 0; vr--) for (let vf = 0; vf < 8; vf++) {
    const f = flipped ? 7 - vf : vf, r = flipped ? 7 - vr : vr;
    const d = document.createElement('div');
    d.className = 'sq ' + ((f + r) % 2 ? 'l' : 'd');
    d.dataset.i = idx(f, r);
    const p = board[idx(f, r)];
    if (p) { const s = document.createElement('span'); s.className = p === p.toUpperCase() ? 'wp' : 'bp'; s.textContent = GLYPH[p]; d.appendChild(s); }
    if (vf === 0 || vr === 0) { const c = document.createElement('div'); c.className = 'coord'; c.textContent = sqName(SQ(f, r)); d.appendChild(c); }
    d.onclick = () => { board[idx(f, r)] = board[idx(f, r)] ? '' : sel; sync(); };
    el.appendChild(d);
  }
}

function toFEN() {
  let out = '';
  for (let r = 7; r >= 0; r--) {
    let run = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[idx(f, r)];
      if (!p) { run++; continue; }
      if (run) { out += run; run = 0; }
      out += p;
    }
    if (run) out += run;
    if (r) out += '/';
  }
  return `${out} ${turn} - -`;
}

function fromFEN(fen) {
  const [rows, t] = fen.trim().split(/\s+/);
  board = new Array(64).fill('');
  let r = 7, f = 0;
  for (const ch of rows) {
    if (ch === '/') { r--; f = 0; continue; }
    if (ch >= '1' && ch <= '8') { f += Number(ch); continue; }
    board[idx(f, r)] = ch; f++;
  }
  turn = t === 'b' ? 'b' : 'w';
  $('#turn').value = turn;
}

function sync() {
  render();
  const fen = toFEN();
  $('#fen').value = fen;
  moves = null; $('#score').innerHTML = '';
  try {
    const b = Board.fromFEN(fen);
    const a = audit(b);
    const kings = board.filter((p) => p === 'K').length === 1 && board.filter((p) => p === 'k').length === 1;
    $('#audit').innerHTML =
      `<div class="verdict ${a.legal ? 'ok' : 'no'}">${a.legal ? '✓ no impossibility found' : '✗ this position cannot occur'}</div>` +
      `<ul>${a.problems.map((p) => `<li class="prob">${p}</li>`).join('')}${a.notes.map((n) => `<li class="note">${n}</li>`).join('')}</ul>` +
      (a.legal && !a.notes.length ? '<div class="hint">nothing structural stands in the way — try finding a game</div>' : '');
    $('#solve').disabled = !a.legal || !kings;
  } catch (e) { $('#audit').innerHTML = `<div class="verdict no">could not parse: ${e.message}</div>`; }
}

function showScore(text, plies) {
  const toks = text.split(' ');
  $('#score').innerHTML = toks.map((t) => `<span>${t}</span>`).join(' ');
}

$('#palette').innerHTML = ORDER.map((p) => `<div class="pk${p === sel ? ' sel' : ''}" data-p="${p}"><span class="${p === p.toUpperCase() ? 'wp' : 'bp'}">${GLYPH[p]}</span></div>`).join('');
$('#palette').onclick = (e) => {
  const k = e.target.closest('.pk'); if (!k) return;
  sel = k.dataset.p;
  [...document.querySelectorAll('.pk')].forEach((x) => x.classList.toggle('sel', x.dataset.p === sel));
};
$('#clear').onclick = () => { board = new Array(64).fill(''); sync(); };
$('#reset').onclick = () => { fromFEN(START); sync(); };
$('#flip').onclick = () => { flipped = !flipped; render(); };
$('#turn').onchange = (e) => { turn = e.target.value; sync(); };
$('#load').onclick = () => { try { fromFEN($('#fen').value); sync(); } catch (e) {} };
$('#fen').onkeydown = (e) => { if (e.key === 'Enter') $('#load').click(); };
$('#exlist').innerHTML = EXAMPLES.map(([n, f], i) => `<a href="#" data-i="${i}">${n}</a>`).join(' · ');
$('#exlist').onclick = (e) => { e.preventDefault(); const i = e.target.dataset.i; if (i != null) { fromFEN(EXAMPLES[i][1]); sync(); } };

$('#solve').onclick = () => {
  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  $('#solve').disabled = true; $('#stop').disabled = false; $('#score').innerHTML = '';
  $('#status').textContent = 'searching…';
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') { $('#status').textContent = m.text; return; }
    $('#solve').disabled = false; $('#stop').disabled = true;
    if (m.ok) {
      $('#status').textContent = `${m.shortest ? 'shortest' : 'a'} proof game — ${Math.ceil(m.plies / 2)} moves (${m.nodes.toLocaleString()} nodes)`;
      showScore(m.score, m.plies);
    } else $('#status').textContent = `no game found — ${m.reason}`;
    worker.terminate(); worker = null;
  };
  worker.postMessage({ fen: toFEN(), mode: $('#mode').value });
};
$('#stop').onclick = () => { worker?.terminate(); worker = null; $('#solve').disabled = false; $('#stop').disabled = true; $('#status').textContent = 'stopped'; };

// image → position, read by a vision model server-side
const drop = $('#drop');
const readImage = async (file) => {
  drop.textContent = 'reading the diagram…';
  const fd = new FormData(); fd.append('image', file);
  try {
    const r = await fetch('/api/vision', { method: 'POST', body: fd });
    const j = await r.json();
    if (j.fen) { fromFEN(j.fen); sync(); drop.textContent = `read as ${j.fen.split(' ')[0]} — check it and correct any square`; }
    else drop.textContent = `could not read it: ${j.error ?? 'unknown'}`;
  } catch (e) { drop.textContent = 'reading failed: ' + e.message; }
};
drop.onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => i.files[0] && readImage(i.files[0]); i.click(); };
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readImage(f); };

fromFEN(EXAMPLES[0][1]);
sync();
fetch('/version.json', { cache: 'no-store' }).then((r) => r.ok ? r.json() : null).then((v) => { if (v) $('#ver').textContent = `v ${v.v} · ${v.at}`; }).catch(() => {});
