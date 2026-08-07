# Proof Game

**Live: [proofgame.exe.xyz](https://proofgame.exe.xyz)**

*How could this position possibly have happened?*

Published puzzle diagrams sometimes look like positions no real game could have
produced. This tool takes a chess position and tries to reconstruct a legal
route to it from the opening array — assuming both players cooperate to reach it.

That turns out to be a composed-chess genre with a long history: the **proof
game**, and when the route must be as short as possible, the *shortest proof
game* — a branch of retrograde analysis with its own dedicated solvers
(Euclide, Natch, Jacobi). Published SPGs mostly run 6–30 moves.

## What it does

**Audit a position.** Before searching, check whether the position is reachable
at all: piece counts, pawns on back ranks, the promotion budget, same-coloured
bishop pairs, adjacent kings, side-to-move versus check, and pawn-capture
accounting (assigning pawns to their home files via Hungarian matching). The
audit often says something useful even when the search can't finish — for
instance *"Black's pawns made at least four captures."*

**Find a game.** Two searches:

- `exact()` — IDA\* with an admissible bound, so when it returns a game that
  game really is the shortest.
- `any()` — weighted best-first with restarts, which reaches much greater depth
  but makes no minimality claim.

**Read a board from a picture.** Paste a screenshot of a diagram and it becomes
an editable position — see below.

## Where it lands

| target | result |
|---|---|
| 10 plies | shortest, instant |
| 16 plies | shortest, ~24 s |
| 24–40 plies | a constructive game in under a second (not minimal) |

The position that started it (`R7/R5pk/1p6/1p4PP/1p6/1p6/1P6/K7` — four black
pawns stacked on the b-file) passes the audit but defeats both searches: it
needs roughly 35 moves with 20 captures at specified squares. The constructive
search closes to within one ply and stalls, which is a fair picture of where a
general heuristic gives out and constraint propagation of the Euclide/Natch kind
has to take over.

## Reading a diagram, in the browser, with no model

`web/vision.js` is canvas only — no network, no weights. It leans on the one
fact that makes rendered diagrams tractable: **every rook in an image is the
same sprite.** So the task isn't "recognise a rook", it's "notice these four
squares hold one shape, then put six names to at most twelve shapes."

1. **Grid** — a board contributes nine evenly spaced edge lines per axis and
   nothing else in a screenshot does; scan for the best-scoring comb of nine.
2. **Pieces** — flood each square inward from its own border, comparing
   neighbouring pixels rather than one global colour, so wood grain and
   gradients behave. A *leash* stops the flood walking a soft outline up into
   the piece; largest-central-blob filtering discards grain specks.
3. **Colour** — the glyph's dominant brightness against its square.
4. **Names** — silhouettes rendered from the Unicode chess figures, matched by
   normalised mask, with chess itself as referee: exactly one king a side, no
   pawns on back ranks, and — since there are only six kinds of chessman — fold
   the closest shapes together until at most six remain.

12/12 across synthetic diagrams in four board styles. Heavy photographic grain
still breaks it, so a vision model on the server stays as a fallback, and **the
legality audit picks the winner**: if the local read is structurally impossible,
ask the model instead. Recognition and rules-checking reinforce each other.

## Pieces, turned rather than downloaded

`web/board3d.js` renders the set in three.js without downloading anything. A
Staunton piece is a silhouette revolved around its axis, which is exactly
`LatheGeometry` — so the set is six profiles, plus a crown of spheres, a ring of
crenellations, a cross, and an extruded head for the knight, who declines to be
a solid of revolution. No licences, no megabytes, sharp at any resolution.
Loaded lazily on the first 3D toggle.

## Running it

```bash
npm install
npm start          # server on :8000
```

Then open <http://localhost:8000>. The solver runs in a Web Worker so the board
stays responsive.

```bash
npm test           # perft + solver regression
npm run cli        # solve from the command line
```

## Layout

```
src/engine.js     0x88 move generator, make/unmake, castling, e.p., promotion
src/analysis.js   legality audit + search heuristic
src/solve.js      exact() IDA*, any() weighted best-first
src/cli.js        command-line entry
web/              board editor, 3D board, worker, client-side diagram reader
test/             perft, solver, UI and vision tests
```

The move generator was validated against published **perft** counts to depth 4
on five standard positions before anything was built on it — a proof-game answer
from a buggy generator would be worse than no answer at all.

## Devlog

The build, and the two bugs that mattered most, are written up in
[`devlog/`](devlog/). Short version: `Int16Array.fill(1e9)` wrapped to −13824,
so unreachable squares looked *cheaper* than reachable ones and IDA\* silently
degenerated into breadth-first search; and the pawn distance ignored the
double-step, which quietly voided the "shortest" guarantee. Fixing both took a
6-ply target from 38 s and 1.3 M nodes down to **12 nodes**.
