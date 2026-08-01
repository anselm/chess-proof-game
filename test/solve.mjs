// Self-test: play N random legal plies from the start, hand the solver only
// the resulting position, and see whether it can reconstruct a game to it.
// (Its answer need not match the random game — any legal route counts, and a
// shorter one is a better answer.)
import { Board, gameScore } from '../src/engine.js';
import { exact, any } from '../src/solve.js';
import { audit } from '../src/analysis.js';

function randomPosition(plies, seed) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let attempt = 0; attempt < 200; attempt++) {
    const b = Board.start();
    let ok = true;
    for (let i = 0; i < plies; i++) {
      const ms = b.legalMoves();
      if (!ms.length) { ok = false; break; }
      b.make(ms[Math.floor(rnd() * ms.length)]);
    }
    if (ok) return b;
  }
  return null;
}

let pass = 0, fail = 0;
for (const plies of [2, 4, 6]) {
  for (const seed of [7, 99]) {
    const pos = randomPosition(plies, seed * plies);
    const fen = pos.toFEN();
    const a = audit(pos);
    const t0 = Date.now();
    const r = exact(pos, { maxPly: plies, nodeBudget: 20e6, timeMs: 60000 });
    const ms = Date.now() - t0;
    const good = r.ok && r.plies <= plies;
    good ? pass++ : fail++;
    console.log(`${good ? 'ok  ' : 'FAIL'} ${plies}-ply target  audit:${a.legal ? 'legal' : 'ILLEGAL'}  ${r.ok ? `found ${r.plies} plies` : r.reason}  ${ms}ms  ${r.nodes.toLocaleString()} nodes`);
    if (good && plies <= 6) console.log(`       ${gameScore(r.moves)}`);
  }
}

// the classic: the initial array is itself a 4-ply proof game (Nf3 Nf6 Ng1 Ng8)
const home = Board.start();
const r = exact(home, { maxPly: 0 });
console.log(`${r.ok && r.plies === 0 ? 'ok  ' : 'FAIL'} initial position solves in 0 plies`);

console.log(`\n${fail ? 'FAIL' : 'PASS'} ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
