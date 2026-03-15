/**
 * Operational Transform for plain text using the Quill Delta format.
 *
 * An operation (Op) is one of:
 *   { retain: n }   — keep n characters unchanged
 *   { insert: "s" } — insert string s at the current position
 *   { delete: n }   — delete n characters at the current position
 *
 * A Delta is an array of Ops that transforms one document state to another.
 * Indices count UTF-16 code units (same as JavaScript's String.prototype methods).
 *
 * Exported functions:
 *   apply(text, delta) → string
 *     Apply a delta to produce a new text string.
 *
 *   compose(a, b) → Delta
 *     Produce a single delta equivalent to applying `a` then `b`.
 *
 *   transform(a, b, priority) → Delta
 *     Transform `a` so it can be applied after `b`.
 *     Returns a′ satisfying: apply(apply(t, b), a′) === apply(apply(t, a), b′)
 *     where b′ = transform(b, a, opposite priority).
 *     priority "left" means `a` wins tie-breaks (its inserts go before `b`'s).
 */

import type { Delta, Op } from "./types.ts";

// ── apply ─────────────────────────────────────────────────────────────────────

/**
 * Apply a delta to a text string, returning the resulting text.
 */
export function apply(text: string, delta: Delta): string {
  let result = "";
  let pos = 0;

  for (const op of delta) {
    if ("retain" in op) {
      if (op.retain <= 0) continue;
      result += text.slice(pos, pos + op.retain);
      pos += op.retain;
    } else if ("insert" in op) {
      result += op.insert;
    } else {
      // delete
      if (op.delete <= 0) continue;
      pos += op.delete;
    }
  }

  // Append any trailing characters not explicitly retained
  result += text.slice(pos);
  return result;
}

// ── Internal: DeltaCursor ─────────────────────────────────────────────────────

/**
 * A cursor that walks through a delta, allowing partial op consumption.
 * Used internally by compose() and transform().
 */
class DeltaCursor {
  private idx = 0;
  private offset = 0;

  constructor(private readonly delta: Delta) {}

  done(): boolean {
    return this.idx >= this.delta.length;
  }

  /** Peek at the type of the current op. Returns "end" when exhausted. */
  peekType(): "retain" | "insert" | "delete" | "end" {
    if (this.done()) return "end";
    const op = this.delta[this.idx];
    if ("retain" in op) return "retain";
    if ("insert" in op) return "insert";
    return "delete";
  }

  /**
   * Remaining "units" in the current op:
   * - retain: number of chars remaining
   * - insert: number of chars remaining in the string
   * - delete: number of chars remaining to delete
   */
  peekLen(): number {
    if (this.done()) return Infinity;
    const op = this.delta[this.idx];
    if ("retain" in op) return op.retain - this.offset;
    if ("insert" in op) return op.insert.length - this.offset;
    return (op as { delete: number }).delete - this.offset;
  }

  /**
   * Consume exactly `n` units from the current op.
   * Advances the cursor accordingly.
   */
  next(n: number): Op {
    const op = this.delta[this.idx];
    if ("retain" in op) {
      const r: Op = { retain: n };
      this.advance(op.retain, n);
      return r;
    } else if ("insert" in op) {
      const r: Op = { insert: op.insert.slice(this.offset, this.offset + n) };
      this.advance(op.insert.length, n);
      return r;
    } else {
      const r: Op = { delete: n };
      this.advance((op as { delete: number }).delete, n);
      return r;
    }
  }

  /** Consume all remaining units from the current op. */
  nextAll(): Op {
    return this.next(this.peekLen());
  }

  private advance(total: number, consumed: number) {
    this.offset += consumed;
    if (this.offset >= total) {
      this.idx++;
      this.offset = 0;
    }
  }
}

// ── Internal: coalescing push ─────────────────────────────────────────────────

/**
 * Push an op onto a result array, coalescing adjacent ops of the same type
 * to keep deltas compact.
 */
function push(result: Op[], op: Op): void {
  if (result.length === 0) {
    result.push({ ...op } as Op);
    return;
  }
  const last = result[result.length - 1];
  if ("retain" in op && "retain" in last) {
    (last as RetainOp).retain += op.retain;
    return;
  }
  if ("insert" in op && "insert" in last) {
    (last as InsertOp).insert += op.insert;
    return;
  }
  if ("delete" in op && "delete" in last) {
    (last as DeleteOp).delete += op.delete;
    return;
  }
  result.push({ ...op } as Op);
}

// Fix: need to reference local named types for push
interface RetainOp { retain: number }
interface InsertOp { insert: string }
interface DeleteOp { delete: number }

// ── compose ───────────────────────────────────────────────────────────────────

/**
 * Compose two sequential deltas `a` and `b` into one.
 *
 * The result delta is equivalent to applying `a` then `b`.
 *
 * Algorithm: walk through `a` and `b` concurrently. `a` produces output
 * characters; `b` consumes those output characters.
 *
 *   b.insert     → always emitted (independent of a)
 *   a.delete     → always emitted (consumes input, produces nothing for b)
 *   a.insert + b.retain(n) → emit a.insert (b keeps it)
 *   a.insert + b.delete(n) → cancel (b deletes what a inserted)
 *   a.retain + b.retain(n) → emit a.retain (both keep)
 *   a.retain + b.delete(n) → emit b.delete (b removes chars a kept)
 */
export function compose(a: Delta, b: Delta): Delta {
  const result: Op[] = [];
  const ai = new DeltaCursor(a);
  const bi = new DeltaCursor(b);

  while (!ai.done() || !bi.done()) {
    // b.insert is independent of a — always pass through
    if (!bi.done() && bi.peekType() === "insert") {
      push(result, bi.nextAll());
      continue;
    }

    // a.delete passes through (consumes input, no a-output for b to act on)
    if (!ai.done() && ai.peekType() === "delete") {
      push(result, ai.nextAll());
      continue;
    }

    // a exhausted: b has remaining retain/delete over implicitly-retained chars
    if (ai.done()) {
      const bOp = bi.nextAll();
      // b.delete over implicit a.retain → emit the delete
      if ("delete" in bOp) push(result, bOp);
      // b.retain over implicit a.retain → no-op (trailing chars are kept)
      continue;
    }

    // b exhausted: a has remaining retain/insert (deletes already handled above)
    if (bi.done()) {
      push(result, ai.nextAll());
      continue;
    }

    // Both cursors are on retain/insert (a) and retain/delete (b)
    const n = Math.min(ai.peekLen(), bi.peekLen());
    const aOp = ai.next(n);
    const bOp = bi.next(n);

    if ("retain" in bOp) {
      // b retains n a-output chars → pass through whatever a did
      push(result, aOp);
    } else {
      // b deletes n a-output chars
      if ("retain" in aOp) {
        // a.retain deleted by b → emit delete
        push(result, { delete: n });
      }
      // a.insert deleted by b → cancel out (emit nothing)
    }
  }

  return result;
}

// ── transform ─────────────────────────────────────────────────────────────────

/**
 * Transform delta `a` against concurrent delta `b`.
 *
 * Returns `a′` such that, for any text `t`:
 *   apply(apply(t, b), a′)  ===  apply(apply(t, a), b′)
 * where b′ = transform(b, a, opposite priority).
 *
 * @param priority
 *   "left"  — `a` has priority: when both insert at the same position,
 *             a's characters come first in the merged result.
 *   "right" — `b` has priority: b's characters come first.
 *
 * Algorithm:
 *   a.insert + b.insert (tie): priority decides order
 *   a.insert + b.* (non-insert): always emit a.insert
 *   b.insert + *: a must skip over b's new chars with a retain
 *   a.retain + b.retain: emit retain
 *   a.retain + b.delete: skip (b removed those chars)
 *   a.delete + b.retain: emit delete (chars still exist after b)
 *   a.delete + b.delete: skip (already gone)
 */
export function transform(a: Delta, b: Delta, priority: "left" | "right"): Delta {
  const result: Op[] = [];
  const ai = new DeltaCursor(a);
  const bi = new DeltaCursor(b);

  while (!ai.done() || !bi.done()) {
    // a.insert: emit it when a has priority, or b is not also inserting
    if (
      !ai.done() &&
      ai.peekType() === "insert" &&
      (priority === "left" || bi.done() || bi.peekType() !== "insert")
    ) {
      push(result, ai.nextAll());
      continue;
    }

    // b.insert: a must retain over these new chars (they're now in the doc after b)
    if (!bi.done() && bi.peekType() === "insert") {
      const ins = bi.nextAll() as InsertOp;
      push(result, { retain: ins.insert.length });
      continue;
    }

    // Both exhausted
    if (ai.done() && bi.done()) break;

    // a exhausted; b has retain/delete — nothing left to transform
    if (ai.done()) { bi.nextAll(); continue; }

    // b exhausted; a has retain/delete — pass through unchanged
    if (bi.done()) { push(result, ai.nextAll()); continue; }

    // Both are retain/delete: process min(aLen, bLen) at once
    const n = Math.min(ai.peekLen(), bi.peekLen());
    const aOp = ai.next(n);
    const bOp = bi.next(n);

    if ("delete" in bOp) {
      // b deleted these chars — a doesn't need to do anything with them
      // (whether a wanted to retain or delete them, they're already gone)
    } else {
      // b retained — pass a's op through unchanged
      push(result, aOp);
    }
  }

  return result;
}
