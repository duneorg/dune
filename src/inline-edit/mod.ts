/**
 * Inline editing types — public interface for the Y.js-based inline editor.
 *
 * The implementation lives in `@dune/plugin-inline-edit`.
 * The client side (Preact island components) lives in `@dune/core/ui/editable`.
 *
 * @module
 * @since 0.16.0
 */

export type {
  InlineEditManager,
  InlineEditManagerOptions,
  InlineEditSession,
  InlineEditClient,
  ActiveEditor,
  DocumentPresence,
} from "./types.ts";
