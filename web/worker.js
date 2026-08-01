// The solver runs off the main thread so the board stays responsive.
import { Board } from '../src/engine.js';
import { exact, any } from '../src/solve.js';
import { gameScore } from '../src/engine.js';

self.onmessage = (e) => {
  const { fen, mode } = e.data;
  const target = Board.fromFEN(fen);
  const post = (p) => self.postMessage({ type: 'progress', ...p });

  const run = (which) => {
    if (which === 'exact') {
      return exact(target, { maxPly: 30, timeMs: 20000, nodeBudget: 12e6,
        onProgress: (p) => post({ text: `shortest search: depth ${p.depth}, ${p.nodes.toLocaleString()} nodes` }) });
    }
    return any(target, { nodeBudget: 6e6, restarts: 10,
      onProgress: (p) => post({ text: `constructive: pass ${p.restart + 1}, ply ${p.depth}, ${p.nodes.toLocaleString()} nodes, ${p.best} to go` }) });
  };

  let r = null;
  if (mode === 'any') r = run('any');
  else {
    r = run('exact');
    if (!r.ok && mode === 'auto') { post({ text: 'no short game — switching to constructive search…' }); r = run('any'); }
  }

  if (r.ok) {
    self.postMessage({ type: 'done', ok: true, shortest: !!r.shortest, plies: r.plies,
      score: gameScore(r.moves), nodes: r.nodes });
  } else {
    self.postMessage({ type: 'done', ok: false, reason: r.reason, nodes: r.nodes });
  }
};
