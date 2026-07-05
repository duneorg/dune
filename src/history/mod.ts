/**
 * History module — barrel exports.
 *
 * @module
 */

export {
  /** Create a history engine. */
  createHistoryEngine,
} from "./engine.ts";
export type {
  /** Records page revisions and provides diff and restore capabilities. Obtain via {@link createHistoryEngine}. */
  HistoryEngine,
  /** Options for {@link createHistoryEngine}. */
  HistoryEngineConfig,
  /** Input for {@link HistoryEngine.record} — captures a page revision. */
  RecordInput,
} from "./engine.ts";
export {
  /** Compute a diff between two strings. */
  computeDiff,
  /** Apply a diff (patch) to reconstruct the new text from the original. */
  applyPatch,
} from "./diff.ts";
