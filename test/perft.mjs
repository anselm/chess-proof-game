// Trust nothing: perft against the standard published node counts. If these
// don't match exactly, every result the solver prints is fiction.
import { Board } from '../src/engine.js';

function perft(b, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of b.legalMoves()) { b.make(m); n += perft(b, d - 1); b.unmake(m); }
  return n;
}

const CASES = [
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', [1, 20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -', [1, 48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -', [1, 14, 191, 2812, 43238]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq -', [1, 6, 264, 9467]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -', [1, 44, 1486, 62379]],
];

let pass = true;
for (const [fen, want] of CASES) {
  const b = Board.fromFEN(fen);
  for (let d = 1; d < want.length; d++) {
    const got = perft(b.clone(), d);
    const ok = got === want[d];
    if (!ok) pass = false;
    console.log(`${ok ? 'ok  ' : 'FAIL'} depth ${d} got ${got} want ${want[d]}  ${fen.slice(0, 40)}`);
  }
}
console.log(pass ? '\nPERFT PASS' : '\nPERFT FAIL');
process.exit(pass ? 0 : 1);
