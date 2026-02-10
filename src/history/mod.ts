/**
 * History module — barrel exports.
 */

export { createHistoryEngine } from "./engine.ts";
export type { HistoryEngine, HistoryEngineConfig, RecordInput } from "./engine.ts";
export { computeDiff, applyPatch } from "./diff.ts";
