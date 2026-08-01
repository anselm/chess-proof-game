// proofgame <FEN> [--exact|--any] [--max N] [--time SEC]
import { Board, gameScore } from './engine.js';
import { audit } from './analysis.js';
import { exact, any, describe } from './solve.js';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const has = (n) => argv.includes(n);
const fen = argv.find((a) => !a.startsWith('--') && a.includes('/')) ??
  'R7/R5pk/1p6/1p4PP/1p6/1p6/1P6/K7 w - - 0 1';

const target = Board.fromFEN(fen);
console.log(`position  ${target.toFEN()}`);
console.log(`pieces    white ${target.count(8)}, black ${target.count(16)}\n`);

const a = audit(target);
console.log(a.legal ? 'AUDIT: no impossibility found' : 'AUDIT: IMPOSSIBLE');
for (const p of a.problems) console.log(`  ✗ ${p}`);
for (const n of a.notes) console.log(`  · ${n}`);
console.log();
if (!a.legal) process.exit(1);

const timeMs = Number(flag('--time', 60)) * 1000;
const maxPly = Number(flag('--max', 30));
const mode = has('--any') ? 'any' : has('--exact') ? 'exact' : 'both';

if (mode === 'exact' || mode === 'both') {
  const t0 = Date.now();
  const r = exact(target, { maxPly, timeMs, onProgress: (p) => process.stderr.write(`\r  exact: depth ${p.depth}, ${p.nodes.toLocaleString()} nodes   `) });
  process.stderr.write('\r' + ' '.repeat(60) + '\r');
  console.log(`exact search (${((Date.now() - t0) / 1000).toFixed(1)}s, ${r.nodes.toLocaleString()} nodes)`);
  console.log('  ' + describe(r).replace(/\n/g, '\n  '));
  if (r.ok) process.exit(0);
  console.log();
}

if (mode === 'any' || mode === 'both') {
  const t0 = Date.now();
  const r = any(target, { nodeBudget: Number(flag('--nodes', 3e6)), onProgress: (p) => process.stderr.write(`\r  any: restart ${p.restart}, depth ${p.depth}, best h ${p.best}, ${p.nodes.toLocaleString()} nodes   `) });
  process.stderr.write('\r' + ' '.repeat(70) + '\r');
  console.log(`constructive search (${((Date.now() - t0) / 1000).toFixed(1)}s, ${r.nodes.toLocaleString()} nodes)`);
  console.log('  ' + describe(r).replace(/\n/g, '\n  '));
}
