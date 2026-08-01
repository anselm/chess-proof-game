// Client-side chess-diagram reader. No model, no network — just canvas.
//
// A rendered diagram is a synthetic image: axis-aligned, flat colours, and
// every rook in it is the *same sprite* as every other rook. That last fact is
// what makes this tractable — we never have to recognise a rook in the
// abstract, only to notice that these four squares hold the same shape, and
// then put six names to at most twelve shapes.
//
//   1. find the grid       nine evenly spaced edge lines across the image
//   2. square colours      the two colours the empty cells are made of
//   3. occupancy           pixels far from this cell's own square colour
//   4. piece colour        light fill vs dark fill among those pixels
//   5. cluster shapes      identical sprites collapse into one group
//   6. name the shapes     silhouette match + the rules of chess as a filter

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export async function toImageData(source, maxDim = 720) {
  const bmp = source instanceof ImageBitmap ? source : await createImageBitmap(source);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// ---------------------------------------------------------------- 1. grid
// Square boundaries show up as vertical/horizontal edges. A board contributes
// nine of them, evenly spaced; nothing else in a screenshot does that.
function edgeProfile(img, axis) {
  const { data, width: w, height: h } = img;
  const n = axis === 'x' ? w : h, m = axis === 'x' ? h : w;
  const prof = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < m; j += 2) {
      const p = axis === 'x' ? (j * w + i) * 4 : (i * w + j) * 4;
      const q = axis === 'x' ? (j * w + i - 1) * 4 : ((i - 1) * w + j) * 4;
      sum += Math.abs(data[p] - data[q]) + Math.abs(data[p + 1] - data[q + 1]) + Math.abs(data[p + 2] - data[q + 2]);
    }
    prof[i] = sum;
  }
  return prof;
}

// returns { off, s }: the first line's offset and the square size
function findLines(prof, n) {
  let best = null;
  const minS = Math.max(8, n / 40), maxS = n / 8;
  for (let s = minS; s <= maxS; s += 0.25) {
    const span = s * 8;
    for (let x0 = 0; x0 + span < n; x0 += 1) {
      let score = 0;
      for (let k = 0; k <= 8; k++) {
        const x = Math.round(x0 + k * s);
        // take the strongest edge within ±1px: rendering rounds boundaries
        score += Math.max(prof[x - 1] ?? 0, prof[x] ?? 0, prof[x + 1] ?? 0);
      }
      if (!best || score > best.score) best = { score, off: x0, s };
    }
  }
  return best;
}

export function findGrid(img) {
  const cx = findLines(edgeProfile(img, 'x'), img.width);
  const cy = findLines(edgeProfile(img, 'y'), img.height);
  if (!cx || !cy) return null;
  // the board is square: reconcile the two independent estimates
  const s = (cx.s + cy.s) / 2;
  const shaky = Math.abs(cx.s - cy.s) / s > 0.12;
  return { x0: cx.off, y0: cy.off, s, shaky };
}

// ------------------------------------------------- 2-4. cells and contents
function cellPixels(img, grid, file, rank, inset = 0.14) {
  const { data, width: w } = img;
  const x0 = grid.x0 + file * grid.s, y0 = grid.y0 + (7 - rank) * grid.s;
  const pad = grid.s * inset;
  const xa = Math.round(x0 + pad), xb = Math.round(x0 + grid.s - pad);
  const ya = Math.round(y0 + pad), yb = Math.round(y0 + grid.s - pad);
  const px = [];
  for (let y = ya; y < yb; y++) {
    if (y < 0 || y >= img.height) continue;
    for (let x = xa; x < xb; x++) {
      if (x < 0 || x >= w) continue;
      const i = (y * w + x) * 4;
      px.push([data[i], data[i + 1], data[i + 2], x - xa, y - ya]);
    }
  }
  return { px, w: xb - xa, h: yb - ya };
}

// the modal colour of a cell is its square colour, whatever sits on it
function modalColour(px) {
  const bins = new Map();
  for (const p of px) {
    const k = (p[0] >> 4) * 256 + (p[1] >> 4) * 16 + (p[2] >> 4);
    let e = bins.get(k);
    if (!e) bins.set(k, (e = { n: 0, r: 0, g: 0, b: 0 }));
    e.n++; e.r += p[0]; e.g += p[1]; e.b += p[2];
  }
  let best = null;
  for (const e of bins.values()) if (!best || e.n > best.n) best = e;
  return [best.r / best.n, best.g / best.n, best.b / best.n, best.n / px.length];
}

// Boards are often textured (wood grain, gradients), so a square is not one
// flat colour — but its luminance still lives in a narrow band. Measured on a
// typical textured diagram: an empty square spans ~46 levels around its mode,
// while any piece reaches far outside that band at both ends. So the test is
// "how much of this cell is far from the cell's own dominant brightness".
// A square is the region connected to the cell's own border; a piece is
// whatever that flood leaves behind in the middle. Growing the region by
// comparing *neighbouring* pixels (rather than against one global colour)
// is what makes wood grain, gradients and pale squares all behave.
function cellGrid(img, grid, file, rank, inset = 0.10) {
  const { data, width: W } = img;
  const x0 = grid.x0 + file * grid.s, y0 = grid.y0 + (7 - rank) * grid.s;
  const pad = grid.s * inset;
  const xa = Math.round(x0 + pad), ya = Math.round(y0 + pad);
  const w = Math.max(1, Math.round(grid.s - 2 * pad)), h = w;
  const L = new Float32Array(w * h), rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = clamp(xa + x, 0, img.width - 1), sy = clamp(ya + y, 0, img.height - 1);
    const i = (sy * W + sx) * 4, j = y * w + x;
    L[j] = lum(data[i], data[i + 1], data[i + 2]);
    rgb[j * 3] = data[i]; rgb[j * 3 + 1] = data[i + 1]; rgb[j * 3 + 2] = data[i + 2];
  }
  // A light blur on the channel used for flooding: board grain is
  // high-frequency and low-amplitude, piece edges are neither, so smoothing
  // costs nothing real and stops grain from fencing the flood in.
  const B = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let sum = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      sum += L[ny * w + nx]; n++;
    }
    B[y * w + x] = sum / n;
  }
  return { L, Lb: B, rgb, w, h };
}

// The outer ring of a cell is square even when the cell is occupied — pieces
// are drawn centred. So the ring tells us the square's brightness and how far
// its texture wanders, and the flood is not allowed to wander further.
function ringStats(cell) {
  const { L, w, h } = cell;
  const ring = [];
  const t = Math.max(1, Math.round(w * 0.06));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
    if (x < t || y < t || x >= w - t || y >= h - t) ring.push(L[y * w + x]);
  ring.sort((a, b) => a - b);
  const q = (p) => ring[clamp(Math.floor(p * (ring.length - 1)), 0, ring.length - 1)];
  return { level: q(0.5), spread: Math.max(6, (q(0.98) - q(0.02)) / 2) };
}

function floodBackground(cell, tol, bound) {
  const { Lb: L, w, h } = cell;
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  for (const s of stack) bg[s] = 1;
  const queue = stack.slice();
  while (queue.length) {
    const p = queue.pop();
    const px = p % w, py = (p / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const q = ny * w + nx;
      if (bg[q]) continue;
      // local continuity *and* a global leash: without the leash a soft
      // outline is a gradient staircase the flood walks straight up
      if (Math.abs(L[q] - L[p]) <= tol && Math.abs(L[q] - bound.level) <= bound.max) { bg[q] = 1; queue.push(q); }
    }
  }
  return bg;
}

function modalLum(list) {
  const hist = new Map();
  for (const L of list) { const b = L >> 4; hist.set(b, (hist.get(b) ?? 0) + 1); }
  let best = 0, bn = -1;
  for (const [b, n] of hist) if (n > bn) { bn = n; best = b; }
  let sum = 0, n = 0;
  for (const L of list) if ((L >> 4) === best) { sum += L; n++; }
  return sum / Math.max(1, n);
}

export function readBoardData(img, tolOverride = null) {
  const grid = findGrid(img);
  if (!grid) return { error: 'no 8×8 grid found in this image' };

  // Ring statistics per cell are fooled by a tall neighbour poking over the
  // boundary, so take the median across each square colour: most rings are
  // clean, and the median ignores the few that are not.
  const raw = [];
  for (let r = 7; r >= 0; r--) for (let f = 0; f < 8; f++) {
    const cell = cellGrid(img, grid, f, r);
    raw.push({ f, r, cell, ring: ringStats(cell) });
  }
  const med = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  const parity = [0, 1].map((p) => {
    const mine = raw.filter((x) => (x.f + x.r) % 2 === p);
    return { level: med(mine.map((x) => x.ring.level)), spread: med(mine.map((x) => x.ring.spread)) };
  });

  // How big a step the flood may take is a property of the board, not a
  // constant: a smooth diagram wants a tight tolerance, a heavily grained one
  // needs to step over its own grain. The leash still keeps it off the pieces.
  const cells = [];
  for (const { f, r, cell } of raw) {
    const ref = parity[(f + r) % 2];
    const tol = tolOverride ?? clamp(ref.spread * 0.9, 8, 32);
    const bg = floodBackground(cell, tol, { level: ref.level, max: ref.spread * 1.4 });
    // A piece is one blob sitting in the middle of its square. Grain leaves
    // scattered specks instead, so keep only the largest connected region and
    // insist it is roughly central — that alone rejects textured empty squares.
    const { w, h } = cell;
    const lab = new Int32Array(w * h).fill(-1);
    let bestN = 0, bestId = -1, id = 0;
    for (let start = 0; start < w * h; start++) {
      if (bg[start] || lab[start] >= 0) continue;
      const q = [start]; lab[start] = id; let n = 0;
      while (q.length) {
        const p = q.pop(); n++;
        const px = p % w, py = (p / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nq = ny * w + nx;
          if (!bg[nq] && lab[nq] < 0) { lab[nq] = id; q.push(nq); }
        }
      }
      if (n > bestN) { bestN = n; bestId = id; }
      id++;
    }
    const fg = [];
    let cx = 0, cy = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const j = y * w + x;
      if (lab[j] === bestId) { fg.push([cell.rgb[j * 3], cell.rgb[j * 3 + 1], cell.rgb[j * 3 + 2], x, y]); cx += x; cy += y; }
    }
    const central = fg.length
      ? Math.abs(cx / fg.length - w / 2) < w * 0.28 && Math.abs(cy / fg.length - h / 2) < h * 0.28
      : false;
    const share = central ? fg.length / (w * h) : 0;
    const bgLum = [];
    for (let j = 0; j < cell.w * cell.h; j++) if (bg[j]) bgLum.push(cell.L[j]);
    cells.push({
      f, r, fg, w: cell.w, h: cell.h,
      // a piece covers a real fraction of its square; stray specks do not
      occupied: share > 0.045 && share < 0.92,
      base: bgLum.length ? modalLum(bgLum) : ref.level,
    });
  }
  return { grid, cells };
}

// piece colour: the dominant brightness of the glyph against its square.
// Every set is a broad fill with a thin contrasting outline, so the mode is
// the fill — and the fill is what tells white from black.
function pieceIsWhite(cell) {
  if (!cell.fg.length) return true;
  return modalLum(cell.fg.map((p) => lum(p[0], p[1], p[2]))) > cell.base;
}

// glyph → normalised binary mask, so shapes can be compared across sizes
const MASK = 20;
function maskOf(cell) {
  if (!cell.fg.length) return null;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const p of cell.fg) { x0 = Math.min(x0, p[3]); x1 = Math.max(x1, p[3]); y0 = Math.min(y0, p[4]); y1 = Math.max(y1, p[4]); }
  const bw = Math.max(1, x1 - x0 + 1), bh = Math.max(1, y1 - y0 + 1);
  const m = new Uint8Array(MASK * MASK);
  for (const p of cell.fg) {
    const mx = clamp(Math.floor((p[3] - x0) / bw * MASK), 0, MASK - 1);
    const my = clamp(Math.floor((p[4] - y0) / bh * MASK), 0, MASK - 1);
    m[my * MASK + mx] = 1;
  }
  return { m, aspect: bw / bh, fill: cell.fg.length / (bw * bh) };
}

const maskDist = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d / a.length;
};


// ------------------------------------------------------ 5-6. shapes → names
// Reference silhouettes are rendered from the Unicode chess figures, which
// share their outlines with essentially every 2D diagram set in use.
let TEMPLATES = null;
function templates() {
  if (TEMPLATES) return TEMPLATES;
  const glyphs = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  TEMPLATES = {};
  const S = 64;
  const c = new OffscreenCanvas(S, S);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  for (const [type, ch] of Object.entries(glyphs)) {
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#000';
    ctx.font = `${Math.round(S * 0.82)}px serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, S / 2, S / 2 + S * 0.04);
    const d = ctx.getImageData(0, 0, S, S).data;
    const pts = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (d[(y * S + x) * 4 + 3] > 90) pts.push([0, 0, 0, x, y]);
    TEMPLATES[type] = maskOf({ fg: pts });
  }
  return TEMPLATES;
}

// Group identical sprites. Then use the fact that there are only six kinds of
// chessman: if we ended up with more shapes than that, the extra ones are the
// same piece segmented slightly differently, so fold the closest pair together
// until at most six remain.
function clusterMasks(items, threshold = 0.12) {
  let groups = [];
  for (const it of items) {
    let hit = null;
    for (const g of groups) if (maskDist(it.mask.m, g.rep.m) < threshold) { hit = g; break; }
    if (hit) hit.members.push(it);
    else groups.push({ rep: it.mask, members: [it] });
  }
  while (groups.length > 6) {
    let a = 0, b = 1, best = Infinity;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const d = maskDist(groups[i].rep.m, groups[j].rep.m);
      if (d < best) { best = d; a = i; b = j; }
    }
    // keep the larger group's sprite as the representative
    const [big, small] = groups[a].members.length >= groups[b].members.length ? [a, b] : [b, a];
    groups[big].members.push(...groups[small].members);
    groups = groups.filter((_, i) => i !== small);
  }
  return groups;
}

// Name each shape by silhouette, then let the rules of chess overrule the
// pixels: exactly one king a side, no pawns on the back ranks, ≤8 pawns.
function nameGroups(groups, isWhite) {
  const T = templates();
  const types = ['k', 'q', 'r', 'b', 'n', 'p'];
  const scored = groups.map((g) => {
    const s = {};
    for (const t of types) s[t] = maskDist(g.rep.m, T[t].m);
    return { g, s, order: types.slice().sort((a, b) => s[a] - s[b]) };
  });
  // biggest group with no back-rank member is almost always the pawns
  scored.sort((a, b) => b.g.members.length - a.g.members.length);
  const used = new Set();
  const out = new Map();
  for (const item of scored) {
    const n = item.g.members.length;
    const backRankOnly = item.g.members.every((m) => m.r === 0 || m.r === 7);
    for (const t of item.order) {
      if (t === 'k' && n !== 1) continue;                       // one king, always
      if (t === 'p' && (n > 8 || item.g.members.some((m) => m.r === 0 || m.r === 7))) continue;
      if (t === 'q' && n > 3) continue;
      if (used.has(t) && t !== 'p') continue;                   // one shape per name
      out.set(item.g, t); used.add(t);
      break;
    }
    if (!out.has(item.g)) out.set(item.g, item.order[0]);
  }
  // if no group got the king, promote the best single-member candidate
  if (![...out.values()].includes('k')) {
    const singles = scored.filter((i) => i.g.members.length === 1);
    if (singles.length) {
      singles.sort((a, b) => a.s.k - b.s.k);
      out.set(singles[0].g, 'k');
    }
  }
  return out;
}

export function readBoard(img) {
  const parsed = readBoardData(img);
  if (parsed.error) return parsed;
  const { cells, grid } = parsed;

  const items = [];
  for (const c of cells) {
    if (!c.occupied) continue;
    const mask = maskOf(c);
    if (!mask) continue;
    items.push({ f: c.f, r: c.r, mask, white: pieceIsWhite(c) });
  }
  if (!items.length) return { error: 'found a grid but no pieces on it' };

  const board = new Array(64).fill('');
  let weakest = 1;
  for (const white of [true, false]) {
    const side = items.filter((i) => i.white === white);
    if (!side.length) continue;
    const groups = clusterMasks(side);
    const names = nameGroups(groups, white);
    for (const g of groups) {
      const t = names.get(g);
      for (const m of g.members) board[m.r * 8 + m.f] = white ? t.toUpperCase() : t;
    }
    // rough confidence: how well the shapes matched their assigned templates
    const T = templates();
    for (const g of groups) weakest = Math.min(weakest, 1 - maskDist(g.rep.m, T[names.get(g)].m) / 0.35);
  }

  let fen = '';
  for (let r = 7; r >= 0; r--) {
    let run = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[r * 8 + f];
      if (!p) { run++; continue; }
      if (run) { fen += run; run = 0; }
      fen += p;
    }
    if (run) fen += run;
    if (r) fen += '/';
  }
  return { fen: `${fen} w - -`, grid, pieces: items.length, confidence: clamp(weakest, 0, 1), shaky: grid.shaky };
}
