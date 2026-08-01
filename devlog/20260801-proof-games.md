# Proof Game — "how could this position have happened?"

**Devlog · 2026-08-01 · live: https://proofgame.exe.xyz**

Anselm noticed that published puzzle diagrams sometimes look like positions no
real game could produce, and asked whether a tool could reconstruct a route
from the opening array to a given position "if both players worked together".

That is exactly the composed-chess genre called a **proof game** (and when the
route is required to be minimal, a *shortest proof game*) — a branch of
retrograde analysis with a small ecosystem of dedicated solvers (Euclide,
Natch, Jacobi). Published SPGs mostly run 6–30 moves.

## What got built

- **`src/engine.js`** — 0x88 move generator with make/unmake, castling, en
  passant, promotion. Validated against published **perft** counts to depth 4
  on five standard positions before anything else was written; a proof-game
  answer from a buggy generator would be worse than no answer.
- **`src/analysis.js`** — the legality audit (piece counts, pawns on back
  ranks, promotion budget, same-coloured bishop pairs, king adjacency, side-to-
  move vs check, and pawn-capture accounting via Hungarian assignment of pawns
  to home files) plus the search heuristic.
- **`src/solve.js`** — `exact()`, IDA* with an admissible bound (so its answer
  really is shortest), and `any()`, weighted best-first with restarts for depth.
- **`web/`** — board builder, instant audit, solver in a Web Worker, and image
  → position via a vision model.

## The two bugs that mattered

1. **`Int16Array.fill(1e9)`** — the "unreachable" sentinel in the distance
   tables wrapped to **−13824**. Unreachable squares therefore looked *cheaper*
   than reachable ones, the heuristic returned 0 for every position, and IDA*
   silently degenerated into breadth-first search. A 6-ply target took 38 s and
   1.3 M nodes.
2. **Pawn distances ignored the double-step**, which made the bound
   *over*-estimate and quietly void the "shortest" guarantee.

Fixing both: the same 6-ply target now solves in **12 nodes**, and h(start) for
a 10-ply target is exactly 10 — tight and admissible.

## Where it lands

| target | result |
|---|---|
| 10 plies | shortest, instant |
| 16 plies | shortest, ~24 s |
| 24–40 plies | constructive game in <1 s (not minimal) |
| the reddit position | audit passes; no game found |

## The reddit position

`R7/R5pk/1p6/1p4PP/1p6/1p6/1P6/K7` — four black pawns stacked on the b-file,
six units a side. The audit clears it and reports the real constraint: **Black's
pawns made at least four captures** (a7, b7, c7 and d7 pawns converging on one
file), and each side is missing ten units. A game is therefore ~35 moves with
20 captures, most of them at specified squares — past both searches here. The
constructive search repeatedly closes to within one ply and stalls, which is a
fair picture of where a general heuristic gives out and constraint propagation
of the Euclide/Natch kind takes over.

## Vision input

Anselm's second ask — a board *recognizer* — turned out to be the easy half:
the server posts the screenshot to a vision model and asks for the placement
field, then loads it into the editor for correction. On the reddit screenshot
it returned the position exactly, first try.

---

## Round two: reading the board here, and turning the pieces

Two follow-ups from Anselm: could the diagram reader run client-side, and
could the board be shown in three.js with real pieces.

### The reader, in the browser, with no model

`web/vision.js` — canvas only, no network, no weights. It leans on the one
fact that makes rendered diagrams tractable: **every rook in an image is the
same sprite**, so the job is not "recognise a rook" but "notice these four
squares hold one shape, then put six names to at most twelve shapes."

1. **Grid** — a board contributes nine evenly spaced edge lines per axis;
   nothing else in a screenshot does. Scan (offset, size) for the best-scoring
   comb of nine.
2. **Squares and pieces** — *flood the square inward from the cell's own
   border*. Comparing neighbouring pixels rather than one global colour is
   what makes wood grain, gradients and pale squares all behave. Two guards
   earned their place: a **leash** (the flood may not wander further from the
   square's level than its texture does — without it, a soft outline is a
   gradient staircase the flood walks straight up into the piece), and
   **largest-central-blob** filtering (a piece is one shape in the middle of
   its square; grain leaves scattered specks).
3. **Colour** — the glyph's dominant brightness against its square. Every set
   is a broad fill with a thin contrasting outline, so the mode is the fill.
4. **Names** — silhouettes rendered from the Unicode chess figures, matched by
   normalised mask, with chess as the referee: exactly one king a side, no
   pawns on the back ranks, and — since there are only six kinds of chessman —
   fold the closest shapes together until at most six remain.

Result on Anselm's Reddit screenshot: **exact**, all twelve pieces. Across
synthetic diagrams in four board styles × three positions: **12/12**. Heavy
photographic grain still breaks it, which is why the model on the server stays
as a fallback — and the **legality audit picks the winner**: if the local read
is structurally impossible, ask the model instead. Recognition and rules
checking reinforcing each other is nicer than either alone.

Bugs worth the telling: `findLines` named its offset `x0` on both axes, so the
vertical origin came back `undefined` and every cell sampled empty space. And
my own *test fixture* was wrong for an hour — it drew hairline glyphs with a
fat contrasting stroke, so its "black" pieces really were mostly light pixels
and the reader was right to call them white. Bad fixtures accuse good code.

### Pieces, turned rather than downloaded

`web/board3d.js`. CC0 chess GLBs do exist, but a Staunton set is a silhouette
revolved around its axis — which is precisely `LatheGeometry`. So the set is
six profiles plus a crown of spheres, a ring of crenellations, a cross, and an
extruded head for the knight, who declines to be a solid of revolution. No
licences, no megabytes, sharp at any resolution, and it matches how the rest
of these projects are built. Loaded lazily on the first 3D toggle.
