/**
 * Inline editing module — real-time Y.js-based inline content editing.
 *
 * Provides:
 * - {@link createInlineEditManager} — server-side manager for WebSocket sync,
 *   Y.js document lifecycle, commit-to-history, and field patching.
 *
 * The client side (Preact island components) lives in `@dune/core/ui/editable`.
 *
 * @module
 * @since 0.16.0
 */

export { createInlineEditManager } from "./manager.ts";
export type {
  InlineEditManager,
  InlineEditManagerOptions,
  InlineEditSession,
  InlineEditClient,
  ActiveEditor,
  DocumentPresence,
} from "./types.ts";
