/**
 * Real-Time Collaboration module public API.
 */

export { createCollabManager } from "./manager.ts";
export type { CollabManager, CollabManagerOptions } from "./types.ts";
export { apply, compose, transform } from "./ot.ts";
