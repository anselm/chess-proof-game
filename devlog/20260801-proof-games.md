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
