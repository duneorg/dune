/**
 * Inline editing service port — the interface core's `/api/inline-edit/*` gate hands requests to.
 *
 * Core ships no implementation. A plugin provides one through
 * the `editor.inline` capability (e.g. `jsr:@dune/plugin-inline-edit`); without
 * one, those endpoints respond 501.
 *
 * @module
 * @since 0.16.0
 */

export type {
  ActiveEditor,
  DocumentPresence,
  EditorIdentity,
  InlineEditManager,
  InlineEditRequestContext,
} from "./types.ts";
