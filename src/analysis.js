// Legality audit + search heuristics.
//
// The audit answers "could this position occur at all?" using cheap structural
// arguments (piece counts, promotion budget, pawn-capture accounting). It is
// sound in one direction only: a FAIL is a proof of impossibility, a PASS just
// means none of these arguments caught it.
//
// The heuristic answers "at least how many moves away from the target is this
// position?" and is admissible: every term is a lower bound on one side's own
// move count, and the two sides' moves are disjoint plies.

import { Board, WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, typeOf, colorOf, SQ, fileOf, rankOf, onBoard, sqName } from './engine.js';

const INF = 1e9;
const BIG = 9999;          // table sentinel: must fit in Int32 and stay positive
const TYPES = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING];
const NAME = { [PAWN]: 'pawn', [KNIGHT]: 'knight', [BISHOP]: 'bishop', [ROOK]: 'rook', [QUEEN]: 'queen', [KING]: 'king' };
const INITIAL = { [PAWN]: 8, [KNIGHT]: 2, [BISHOP]: 2, [ROOK]: 2, [QUEEN]: 1, [KING]: 1 };

// ---------------------------------------------------------------- distances
// min moves for a piece of each type between any two squares on an empty board
const DIST = {};
function buildDistances() {
  const dirs = {
    [KNIGHT]: [33, 31, 18, 14, -33, -31, -18, -14],
    [BISHOP]: [17, 15, -17, -15],
    [ROOK]: [16, -16, 1, -1],
    [QUEEN]: [17, 15, -17, -15, 16, -16, 1, -1],
    [KING]: [17, 15, -17, -15, 16, -16, 1, -1],
  };
  const slide = { [BISHOP]: 1, [ROOK]: 1, [QUEEN]: 1 };
  for (const t of [KNIGHT, BISHOP, ROOK, QUEEN, KING]) {
    const table = new Int32Array(128 * 128).fill(BIG);
    for (let s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      table[s * 128 + s] = 0;
      const q = [s];
      while (q.length) {
        const cur = q.shift();
        const d0 = table[s * 128 + cur];
        for (const d of dirs[t]) {
          let x = cur + d;
          while (onBoard(x)) {
            if (table[s * 128 + x] > d0 + 1) { table[s * 128 + x] = d0 + 1; q.push(x); }
            if (!slide[t]) break;
            x += d;
          }
        }
      }
    }
    DIST[t] = table;
  }
}
buildDistances();

export function pieceDistance(type, from, to) {
  if (from === to) return 0;
  const d = DIST[type][from * 128 + to];
  return d >= BIG ? INF : d;
}

// a pawn can only go forward; sideways steps cost one capture each
export function pawnDistance(color, from, to) {
  const dr = color === WHITE ? rankOf(to) - rankOf(from) : rankOf(from) - rankOf(to);
  const df = Math.abs(fileOf(to) - fileOf(from));
  if (dr < 0) return INF;
  if (dr === 0) return from === to ? 0 : INF;
  if (df > dr) return INF;              // every file change costs a rank as well
  const home = rankOf(from) === (color === WHITE ? 1 : 6);
  // the initial double-step covers two ranks in one move (but changes no file)
  return home && dr >= 2 ? Math.min(dr, 1 + Math.max(df, dr - 2)) : dr;
}

// --------------------------------------------------- min-cost assignment
// Hungarian algorithm (O(n^3)) on a square cost matrix.
export function hungarian(cost) {
  const n = cost.length;
  if (!n) return { cost: 0, assign: [] };
  const m = cost[0].length;
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1).fill(-1), way = new Int32Array(m + 1);
  for (let i = 0; i < n; i++) {
    p[m] = i;
    let j0 = m;
    const minv = new Float64Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = -1;
      for (let j = 0; j < m; j++) {
        if (used[j]) continue;
        const cur = (i0 >= 0 ? cost[i0][j] : 0) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      if (j1 < 0) break;
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
        else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== -1);
    while (j0 !== m) { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; }
  }
  const assign = new Int32Array(n).fill(-1);
  let total = 0;
  for (let j = 0; j < m; j++) if (p[j] >= 0 && p[j] < n) { assign[p[j]] = j; total += cost[p[j]][j]; }
  return { cost: total, assign: Array.from(assign) };
}

// minimum captures this side's pawns must have made, from their file spread:
// match each surviving pawn to a distinct home file, paying |file difference|
export function pawnCaptureFloor(board, color) {
  const pawns = board.pieces(color).filter((p) => p.type === PAWN);
  if (!pawns.length) return 0;
  const cost = pawns.map((p) => Array.from({ length: 8 }, (_, f) => Math.abs(fileOf(p.sq) - f)));
  return hungarian(cost).cost;
}

// ------------------------------------------------------------------ audit
export function audit(board) {
  const problems = [], notes = [];
  const fail = (m) => problems.push(m);

  for (const color of [WHITE, BLACK]) {
    const who = color === WHITE ? 'White' : 'Black';
    const ps = board.pieces(color);
    const byType = {};
    for (const t of TYPES) byType[t] = ps.filter((p) => p.type === t).length;

    if (byType[KING] !== 1) fail(`${who} has ${byType[KING]} kings`);
    if (ps.length > 16) fail(`${who} has ${ps.length} pieces (max 16)`);
    if (byType[PAWN] > 8) fail(`${who} has ${byType[PAWN]} pawns (max 8)`);

    for (const p of ps) {
      if (p.type === PAWN && (rankOf(p.sq) === 0 || rankOf(p.sq) === 7)) fail(`${who} pawn on ${sqName(p.sq)} — pawns cannot stand on the back ranks`);
    }

    // promotions must be paid for with missing pawns
    let promotionsNeeded = 0;
    for (const t of [KNIGHT, BISHOP, ROOK, QUEEN]) promotionsNeeded += Math.max(0, byType[t] - INITIAL[t]);
    const pawnsMissing = INITIAL[PAWN] - byType[PAWN];
    if (promotionsNeeded > pawnsMissing) {
      fail(`${who} needs ${promotionsNeeded} promotion${promotionsNeeded > 1 ? 's' : ''} but only ${pawnsMissing} pawn${pawnsMissing === 1 ? ' is' : 's are'} missing`);
    } else if (promotionsNeeded) {
      notes.push(`${who} must have promoted at least ${promotionsNeeded} pawn${promotionsNeeded > 1 ? 's' : ''}`);
    }

    // same-coloured bishop pairs beyond the original one are promotions too
    const bishops = ps.filter((p) => p.type === BISHOP);
    const light = bishops.filter((p) => (fileOf(p.sq) + rankOf(p.sq)) % 2 === 1).length;
    const dark = bishops.length - light;
    const extraB = Math.max(0, light - 1) + Math.max(0, dark - 1);
    if (extraB > pawnsMissing) fail(`${who} has ${light} light- and ${dark} dark-squared bishops, needing ${extraB} promotions, with only ${pawnsMissing} pawns missing`);

    // capture accounting: every sideways pawn step ate an enemy unit
    const floor = pawnCaptureFloor(board, color);
    const enemyMissing = Math.max(0, 16 - board.count(color === WHITE ? BLACK : WHITE));
    if (floor > enemyMissing) {
      fail(`${who}'s pawn structure needs at least ${floor} capture${floor > 1 ? 's' : ''}, but only ${enemyMissing} ${color === WHITE ? 'black' : 'white'} unit${enemyMissing === 1 ? ' is' : 's are'} missing`);
    } else if (floor) {
      notes.push(`${who}'s pawns made at least ${floor} capture${floor > 1 ? 's' : ''} (of ${enemyMissing} available)`);
    }
  }

  // kings may not touch, and the side that just moved may not be in check
  const wk = board.kings[WHITE], bk = board.kings[BLACK];
  if (wk >= 0 && bk >= 0) {
    if (Math.abs(fileOf(wk) - fileOf(bk)) <= 1 && Math.abs(rankOf(wk) - rankOf(bk)) <= 1) fail('the kings are adjacent');
    const idle = board.turn === WHITE ? BLACK : WHITE;
    if (board.attacked(board.kings[idle], board.turn)) fail(`${idle === WHITE ? 'White' : 'Black'} is in check but it is ${board.turn === WHITE ? 'White' : 'Black'}'s turn — that check could never have been left standing`);
  }

  return { legal: problems.length === 0, problems, notes };
}

// -------------------------------------------------------------- heuristic
// Lower bound, in plies, on the distance from `board` to `target`.
//
// Relaxation: every target square must end up holding a piece of its type, so
// the cost of filling it is at least the distance of the *nearest* candidate.
// Letting several targets claim the same piece only lowers the total, which
// keeps the bound admissible — and drops the cost from an O(n^3) assignment to
// a couple of hundred array lookups, which is what makes the search viable.
export function makeHeuristic(target) {
  const T = {};
  for (const color of [WHITE, BLACK]) {
    T[color] = target.pieces(color).map((p) => ({ type: p.type, sq: p.sq }));
  }
  const targetCount = { [WHITE]: T[WHITE].length, [BLACK]: T[BLACK].length };
  const curSq = new Int32Array(32), curType = new Int32Array(32);

  function sideBound(board, color) {
    let n = 0, count = 0;
    for (let i = 0; i < 128; i++) {
      if (i & 0x88) continue;
      const p = board.sq[i];
      if (!p || (p & 24) !== color) continue;
      curSq[n] = i; curType[n] = p & 7; n++; count++;
    }
    const tgt = T[color];
    let sum = 0;
    for (let k = 0; k < tgt.length; k++) {
      const tt = tgt[k].type, ts = tgt[k].sq;
      let best = INF;
      for (let j = 0; j < n; j++) {
        const ct = curType[j], cs = curSq[j];
        let d;
        if (ct === tt) {
          if (ct === PAWN) {
            if (cs === ts) d = 0;
            else {
              const dr = color === WHITE ? rankOf(ts) - rankOf(cs) : rankOf(cs) - rankOf(ts);
              const df = Math.abs(fileOf(ts) - fileOf(cs));
              if (dr <= 0 || df > dr) d = INF;
              else {
                const home = rankOf(cs) === (color === WHITE ? 1 : 6);
                d = home && dr >= 2 ? Math.min(dr, 1 + Math.max(df, dr - 2)) : dr;
              }
            }
          } else { d = cs === ts ? 0 : DIST[ct][cs * 128 + ts]; if (d >= BIG) d = INF; }
        } else if (ct === PAWN) {
          // could still promote into this piece; cheapest possible such route
          const run = color === WHITE ? 7 - rankOf(cs) : rankOf(cs);
          const home = rankOf(cs) === (color === WHITE ? 1 : 6);
          d = run <= 0 ? INF : (home && run >= 2 ? run - 1 : run);
        } else continue;
        if (d < best) { best = d; if (!best) break; }
      }
      if (best >= INF) return INF;
      sum += best;
    }
    // every enemy unit that still has to vanish costs this side a capture move
    const enemyNow = board.count(color === WHITE ? BLACK : WHITE);
    const mustCapture = enemyNow - targetCount[color === WHITE ? BLACK : WHITE];
    if (mustCapture < 0) return INF;                    // we cannot un-capture
    return Math.max(sum, mustCapture);
  }

  return function h(board) {
    const w = sideBound(board, WHITE);
    if (w >= INF) return INF;
    const b = sideBound(board, BLACK);
    if (b >= INF) return INF;
    let total = w + b;
    const need = (target.turn === WHITE) === (board.turn === WHITE) ? 0 : 1;
    if (total % 2 !== need % 2) total++;
    return total;
  };
}

export const UNREACHABLE = INF;
