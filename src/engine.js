// A compact 0x88 chess engine: board, legal move generation, make/unmake, FEN.
// Built for search speed (millions of make/unmake per second), not for playing
// strength — there is no evaluation here at all. Squares are 0x88: file = i&7,
// rank = i>>4, and (i & 0x88) !== 0 means off-board.

export const EMPTY = 0;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 8, BLACK = 16;                 // colour bits
export const typeOf = (p) => p & 7;
export const colorOf = (p) => p & 24;

export const SQ = (file, rank) => rank * 16 + file; // rank 0 = 1st rank
export const fileOf = (s) => s & 7;
export const rankOf = (s) => s >> 4;
export const onBoard = (s) => (s & 0x88) === 0;
export const sqName = (s) => 'abcdefgh'[fileOf(s)] + (rankOf(s) + 1);
export const nameSq = (n) => SQ('abcdefgh'.indexOf(n[0]), Number(n[1]) - 1);

const N = 16, S = -16, E = 1, W = -1;
const DIRS = {
  [KNIGHT]: [33, 31, 18, 14, -33, -31, -18, -14],
  [BISHOP]: [17, 15, -17, -15],
  [ROOK]: [16, -16, 1, -1],
  [QUEEN]: [17, 15, -17, -15, 16, -16, 1, -1],
  [KING]: [17, 15, -17, -15, 16, -16, 1, -1],
};
const SLIDER = { [BISHOP]: 1, [ROOK]: 1, [QUEEN]: 1 };

const PIECE_CHAR = { [PAWN]: 'p', [KNIGHT]: 'n', [BISHOP]: 'b', [ROOK]: 'r', [QUEEN]: 'q', [KING]: 'k' };
const CHAR_PIECE = { p: PAWN, n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN, k: KING };

// move packing: from | to<<8 | flags<<16 | promo<<20 | captured<<24
export const M_FROM = (m) => m & 0xff;
export const M_TO = (m) => (m >> 8) & 0xff;
export const M_FLAGS = (m) => (m >> 16) & 0xf;
export const M_PROMO = (m) => (m >> 20) & 0xf;
export const M_CAP = (m) => (m >> 24) & 0x1f;
export const F_NORMAL = 0, F_CAPTURE = 1, F_EP = 2, F_DOUBLE = 3, F_CASTLE_K = 4, F_CASTLE_Q = 5, F_PROMO = 6, F_PROMO_CAP = 7;
const mk = (from, to, flags = 0, promo = 0, cap = 0) => from | (to << 8) | (flags << 16) | (promo << 20) | (cap << 24);

export class Board {
  constructor() {
    this.sq = new Uint8Array(128);
    this.turn = WHITE;
    this.castle = 0;                 // 1 K, 2 Q, 4 k, 8 q
    this.ep = -1;
    this.ply = 0;
    this.kings = { [WHITE]: -1, [BLACK]: -1 };
    this.hist = [];
  }

  clone() {
    const b = new Board();
    b.sq.set(this.sq);
    b.turn = this.turn; b.castle = this.castle; b.ep = this.ep; b.ply = this.ply;
    b.kings = { ...this.kings };
    return b;
  }

  static fromFEN(fen) {
    const b = new Board();
    const [rows, turn, castle, ep] = fen.trim().split(/\s+/);
    let rank = 7, file = 0;
    for (const ch of rows) {
      if (ch === '/') { rank--; file = 0; continue; }
      if (ch >= '1' && ch <= '8') { file += Number(ch); continue; }
      const color = ch === ch.toUpperCase() ? WHITE : BLACK;
      const type = CHAR_PIECE[ch.toLowerCase()];
      const s = SQ(file, rank);
      b.sq[s] = type | color;
      if (type === KING) b.kings[color] = s;
      file++;
    }
    b.turn = turn === 'b' ? BLACK : WHITE;
    b.castle = 0;
    if (castle && castle !== '-') {
      if (castle.includes('K')) b.castle |= 1;
      if (castle.includes('Q')) b.castle |= 2;
      if (castle.includes('k')) b.castle |= 4;
      if (castle.includes('q')) b.castle |= 8;
    }
    b.ep = ep && ep !== '-' ? nameSq(ep) : -1;
    return b;
  }

  static start() {
    return Board.fromFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  toFEN(includeCounters = true) {
    let out = '';
    for (let rank = 7; rank >= 0; rank--) {
      let run = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.sq[SQ(file, rank)];
        if (!p) { run++; continue; }
        if (run) { out += run; run = 0; }
        const c = PIECE_CHAR[typeOf(p)];
        out += colorOf(p) === WHITE ? c.toUpperCase() : c;
      }
      if (run) out += run;
      if (rank) out += '/';
    }
    const cast = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') +
                 (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
    out += ` ${this.turn === WHITE ? 'w' : 'b'} ${cast || '-'} ${this.ep >= 0 ? sqName(this.ep) : '-'}`;
    return includeCounters ? `${out} 0 ${1 + (this.ply >> 1)}` : out;
  }

  // position-only key: what a proof game must match (piece placement + side to
  // move). castling/ep are compared separately when the target specifies them.
  key() {
    let k = '';
    for (let rank = 7; rank >= 0; rank--) for (let file = 0; file < 8; file++) k += String.fromCharCode(48 + this.sq[SQ(file, rank)]);
    return k + (this.turn === WHITE ? 'w' : 'b');
  }

  attacked(sq, byColor) {
    for (let i = 0; i < 128; i++) {
      if (i & 0x88) continue;
      const p = this.sq[i];
      if (!p || colorOf(p) !== byColor) continue;
      const t = typeOf(p);
      if (t === PAWN) {
        const dir = byColor === WHITE ? N : S;
        if (i + dir + E === sq || i + dir + W === sq) return true;
        continue;
      }
      if (t === KNIGHT || t === KING) {
        for (const d of DIRS[t]) if (i + d === sq) return true;
        continue;
      }
      for (const d of DIRS[t]) {
        let x = i + d;
        while (onBoard(x)) {
          if (x === sq) return true;
          if (this.sq[x]) break;
          x += d;
        }
      }
    }
    return false;
  }

  inCheck(color = this.turn) {
    return this.attacked(this.kings[color], color === WHITE ? BLACK : WHITE);
  }

  // pseudo-legal generation; legality filtered in legalMoves()
  genMoves(out = []) {
    const me = this.turn, them = me === WHITE ? BLACK : WHITE;
    for (let i = 0; i < 128; i++) {
      if (i & 0x88) continue;
      const p = this.sq[i];
      if (!p || colorOf(p) !== me) continue;
      const t = typeOf(p);

      if (t === PAWN) {
        const dir = me === WHITE ? N : S;
        const startRank = me === WHITE ? 1 : 6;
        const lastRank = me === WHITE ? 7 : 0;
        const one = i + dir;
        if (onBoard(one) && !this.sq[one]) {
          if (rankOf(one) === lastRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push(mk(i, one, F_PROMO, pr));
          else {
            out.push(mk(i, one, F_NORMAL));
            const two = one + dir;
            if (rankOf(i) === startRank && !this.sq[two]) out.push(mk(i, two, F_DOUBLE));
          }
        }
        for (const dd of [dir + E, dir + W]) {
          const c = i + dd;
          if (!onBoard(c)) continue;
          const victim = this.sq[c];
          if (victim && colorOf(victim) === them) {
            if (rankOf(c) === lastRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push(mk(i, c, F_PROMO_CAP, pr, victim));
            else out.push(mk(i, c, F_CAPTURE, 0, victim));
          } else if (c === this.ep) {
            out.push(mk(i, c, F_EP, 0, PAWN | them));
          }
        }
        continue;
      }

      if (t === KNIGHT || t === KING) {
        for (const d of DIRS[t]) {
          const x = i + d;
          if (!onBoard(x)) continue;
          const v = this.sq[x];
          if (!v) out.push(mk(i, x, F_NORMAL));
          else if (colorOf(v) === them) out.push(mk(i, x, F_CAPTURE, 0, v));
        }
        if (t === KING) {
          const kSide = me === WHITE ? 1 : 4, qSide = me === WHITE ? 2 : 8;
          const home = me === WHITE ? SQ(4, 0) : SQ(4, 7);
          if (i === home && !this.inCheck(me)) {
            if ((this.castle & kSide) && !this.sq[i + 1] && !this.sq[i + 2] &&
                !this.attacked(i + 1, them) && !this.attacked(i + 2, them)) out.push(mk(i, i + 2, F_CASTLE_K));
            if ((this.castle & qSide) && !this.sq[i - 1] && !this.sq[i - 2] && !this.sq[i - 3] &&
                !this.attacked(i - 1, them) && !this.attacked(i - 2, them)) out.push(mk(i, i - 2, F_CASTLE_Q));
          }
        }
        continue;
      }

      for (const d of DIRS[t]) {
        let x = i + d;
        while (onBoard(x)) {
          const v = this.sq[x];
          if (!v) out.push(mk(i, x, F_NORMAL));
          else { if (colorOf(v) === them) out.push(mk(i, x, F_CAPTURE, 0, v)); break; }
          x += d;
        }
      }
    }
    return out;
  }

  legalMoves() {
    const out = [];
    for (const m of this.genMoves()) {
      this.make(m);
      const ok = !this.attacked(this.kings[this.turn === WHITE ? BLACK : WHITE], this.turn);
      this.unmake(m);
      if (ok) out.push(m);
    }
    return out;
  }

  make(m) {
    const from = M_FROM(m), to = M_TO(m), flags = M_FLAGS(m), promo = M_PROMO(m);
    const p = this.sq[from], me = colorOf(p);
    this.hist.push({ castle: this.castle, ep: this.ep, kings: this.kings[WHITE] * 256 + this.kings[BLACK] });
    this.sq[to] = p; this.sq[from] = 0;
    this.ep = -1;

    if (flags === F_DOUBLE) this.ep = me === WHITE ? to - 16 : to + 16;
    else if (flags === F_EP) this.sq[me === WHITE ? to - 16 : to + 16] = 0;
    else if (flags === F_PROMO || flags === F_PROMO_CAP) this.sq[to] = promo | me;
    else if (flags === F_CASTLE_K) { this.sq[to - 1] = this.sq[to + 1]; this.sq[to + 1] = 0; }
    else if (flags === F_CASTLE_Q) { this.sq[to + 1] = this.sq[to - 2]; this.sq[to - 2] = 0; }

    if (typeOf(p) === KING) {
      this.kings[me] = to;
      this.castle &= me === WHITE ? ~3 : ~12;
    }
    // any move from/to a corner kills the matching castling right
    if (from === SQ(0, 0) || to === SQ(0, 0)) this.castle &= ~2;
    if (from === SQ(7, 0) || to === SQ(7, 0)) this.castle &= ~1;
    if (from === SQ(0, 7) || to === SQ(0, 7)) this.castle &= ~8;
    if (from === SQ(7, 7) || to === SQ(7, 7)) this.castle &= ~4;

    this.turn = me === WHITE ? BLACK : WHITE;
    this.ply++;
  }

  unmake(m) {
    const from = M_FROM(m), to = M_TO(m), flags = M_FLAGS(m), cap = M_CAP(m);
    const h = this.hist.pop();
    const p = this.sq[to];
    const me = colorOf(p);
    this.sq[from] = (flags === F_PROMO || flags === F_PROMO_CAP) ? (PAWN | me) : p;
    this.sq[to] = 0;

    if (flags === F_CAPTURE || flags === F_PROMO_CAP) this.sq[to] = cap;
    else if (flags === F_EP) this.sq[me === WHITE ? to - 16 : to + 16] = cap;
    else if (flags === F_CASTLE_K) { this.sq[to + 1] = this.sq[to - 1]; this.sq[to - 1] = 0; }
    else if (flags === F_CASTLE_Q) { this.sq[to - 2] = this.sq[to + 1]; this.sq[to + 1] = 0; }

    this.castle = h.castle; this.ep = h.ep;
    this.kings[WHITE] = (h.kings / 256) | 0; this.kings[BLACK] = h.kings % 256;
    this.turn = me;
    this.ply--;
  }

  pieces(color) {
    const out = [];
    for (let i = 0; i < 128; i++) {
      if (i & 0x88) continue;
      const p = this.sq[i];
      if (p && colorOf(p) === color) out.push({ sq: i, type: typeOf(p) });
    }
    return out;
  }

  count(color) { return this.pieces(color).length; }
}

// SAN-ish rendering, good enough for a readable game score
export function toSAN(board, m) {
  const from = M_FROM(m), to = M_TO(m), flags = M_FLAGS(m);
  const p = board.sq[from], t = typeOf(p);
  if (flags === F_CASTLE_K) return 'O-O';
  if (flags === F_CASTLE_Q) return 'O-O-O';
  const cap = flags === F_CAPTURE || flags === F_PROMO_CAP || flags === F_EP;
  let s;
  if (t === PAWN) {
    s = cap ? `${'abcdefgh'[fileOf(from)]}x${sqName(to)}` : sqName(to);
    if (flags === F_PROMO || flags === F_PROMO_CAP) s += '=' + PIECE_CHAR[M_PROMO(m)].toUpperCase();
  } else {
    // disambiguate against same-type pieces that could also reach `to`
    let same = 0, sameFile = 0, sameRank = 0;
    for (const alt of board.legalMoves()) {
      if (M_TO(alt) === to && M_FROM(alt) !== from && typeOf(board.sq[M_FROM(alt)]) === t) {
        same++;
        if (fileOf(M_FROM(alt)) === fileOf(from)) sameFile++;
        if (rankOf(M_FROM(alt)) === rankOf(from)) sameRank++;
      }
    }
    let dis = '';
    if (same) dis = !sameFile ? 'abcdefgh'[fileOf(from)] : !sameRank ? String(rankOf(from) + 1) : sqName(from);
    s = PIECE_CHAR[t].toUpperCase() + dis + (cap ? 'x' : '') + sqName(to);
  }
  board.make(m);
  const chk = board.inCheck(board.turn);
  const noReply = chk && board.legalMoves().length === 0;
  board.unmake(m);
  return s + (noReply ? '#' : chk ? '+' : '');
}

export function gameScore(moves, start = Board.start()) {
  const b = start.clone();
  const parts = [];
  for (let i = 0; i < moves.length; i++) {
    const san = toSAN(b, moves[i]);
    if (i % 2 === 0) parts.push(`${1 + (i >> 1)}.${san}`);
    else parts.push(san);
    b.make(moves[i]);
  }
  return parts.join(' ');
}
