// Two searches over the same board:
//
//   exact()  — IDA* with an admissible heuristic. Because the bound only ever
//              under-estimates, the first solution found at a given depth is a
//              genuine *shortest* proof game.
//   any()    — weighted best-first with restarts. Drops the optimality promise
//              in exchange for reaching positions dozens of moves deep, which
//              is what most real puzzle positions need.
//
// Both are cooperative: there is no opponent, only two hands moving toward the
// same arrangement.

import { Board, WHITE, BLACK, typeOf, colorOf, M_FROM, M_TO, M_FLAGS, F_CAPTURE, F_PROMO_CAP, F_EP, gameScore } from './engine.js';
import { makeHeuristic, UNREACHABLE } from './analysis.js';

export function exact(target, { maxPly = 20, nodeBudget = 40e6, timeMs = 60000, onProgress } = {}) {
  const deadline = Date.now() + timeMs;
  const h = makeHeuristic(target);
  const goal = target.key();
  const start = Board.start();
  const h0 = h(start);
  if (h0 >= UNREACHABLE) return { ok: false, reason: 'heuristic says unreachable', nodes: 0 };

  let nodes = 0, cutoff = h0;
  const line = [];

  // h is evaluated once per node; children are only ordered near the root,
  // where a good first guess pays for the extra evaluations.
  function dfs(board, g, bound, hCur) {
    if ((nodes & 4095) === 0 && Date.now() > deadline) throw new Error('time');
    nodes++;
    if (nodes > nodeBudget) throw new Error('budget');
    if (hCur === 0 && board.key() === goal) return -1;
    let next = Infinity;
    const moves = board.legalMoves();
    const order = g < 4 ? [] : null;
    for (const m of moves) {
      board.make(m);
      const hc = h(board);
      if (order) order.push([hc, m]);
      else {
        if (g + 1 + hc <= bound) {
          line.push(m);
          const t = dfs(board, g + 1, bound, hc);
          if (t === -1) { board.unmake(m); return -1; }
          line.pop();
          if (t < next) next = t;
        } else if (g + 1 + hc < next) next = g + 1 + hc;
      }
      board.unmake(m);
    }
    if (order) {
      order.sort((a, b) => a[0] - b[0]);
      for (const [hc, m] of order) {
        if (g + 1 + hc > bound) { if (g + 1 + hc < next) next = g + 1 + hc; continue; }
        board.make(m);
        line.push(m);
        const t = dfs(board, g + 1, bound, hc);
        if (t === -1) { board.unmake(m); return -1; }
        line.pop();
        board.unmake(m);
        if (t < next) next = t;
      }
    }
    return next;
  }

  while (cutoff <= maxPly) {
    onProgress?.({ phase: 'exact', depth: cutoff, nodes });
    let t;
    try { t = dfs(start.clone(), 0, cutoff, h0); }
    catch (e) { return { ok: false, reason: e.message === 'time' ? `time limit at depth ${cutoff} (${nodes.toLocaleString()} nodes)` : `node budget (${nodes.toLocaleString()} nodes)`, nodes, depthReached: cutoff }; }
    if (t === -1) return { ok: true, shortest: true, moves: line.slice(), plies: line.length, nodes };
    if (t === Infinity) return { ok: false, reason: 'search exhausted — position is unreachable', nodes };
    cutoff = t;
  }
  return { ok: false, reason: `no proof game within ${maxPly} plies`, nodes, depthReached: cutoff };
}

// ---------------------------------------------------------------- any()
// Weighted best-first: f = g + W·h. With W high the search charges at the
// target and accepts a longer game; restarts with jitter shake it out of the
// local traps that cooperative search still manages to find.
export function any(target, {
  weight = 4, beam = 260, restarts = 24, nodeBudget = 3e6, maxPly = 200, onProgress,
} = {}) {
  const h = makeHeuristic(target);
  const goal = target.key();
  let best = null, nodes = 0;

  for (let r = 0; r < restarts; r++) {
    const seen = new Map();
    let frontier = [{ board: Board.start(), line: [], h: h(Board.start()) }];
    seen.set(frontier[0].board.key(), 0);
    const jitter = r === 0 ? 0 : 0.6 + r * 0.15;

    for (let depth = 0; depth < maxPly && frontier.length; depth++) {
      const next = [];
      for (const node of frontier) {
        const moves = node.board.legalMoves();
        for (const m of moves) {
          node.board.make(m);
          const key = node.board.key();
          if (node.board.key() === goal) {
            const line = [...node.line, m];
            node.board.unmake(m);
            if (!best || line.length < best.length) best = line;
            return { ok: true, shortest: false, moves: best, plies: best.length, nodes, restarts: r + 1 };
          }
          const hv = h(node.board);
          nodes++;
          if (hv < UNREACHABLE && (!seen.has(key) || seen.get(key) > depth + 1)) {
            seen.set(key, depth + 1);
            next.push({ board: node.board.clone(), line: [...node.line, m], h: hv });
          }
          node.board.unmake(m);
          if (nodes > nodeBudget) break;
        }
        if (nodes > nodeBudget) break;
      }
      if (nodes > nodeBudget) break;
      // keep the most promising `beam` successors
      for (const n of next) n.score = n.line.length + weight * n.h + (jitter ? Math.random() * jitter * weight : 0);
      next.sort((a, b) => a.score - b.score);
      frontier = next.slice(0, beam);
      if (depth % 6 === 0) onProgress?.({ phase: 'any', restart: r, depth, nodes, best: frontier[0]?.h });
    }
    if (nodes > nodeBudget) break;
  }
  return { ok: false, reason: `no proof game found (${nodes.toLocaleString()} nodes searched)`, nodes };
}

export function describe(result) {
  if (!result.ok) return `no game found: ${result.reason}`;
  const moves = Math.ceil(result.plies / 2);
  return `${result.shortest ? 'shortest ' : ''}proof game in ${moves} move${moves === 1 ? '' : 's'} (${result.plies} plies):\n${gameScore(result.moves)}`;
}
