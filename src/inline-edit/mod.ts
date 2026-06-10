/**
 * Inline editing service port — the interface core's admin endpoints consume.
 *
 * Core ships no implementation. A plugin provides one through
 * `DunePlugin.adminServices` (e.g. `jsr:@dune/plugin-inline-edit`); without
 * one, the inline-edit admin endpoints respond 501.
 *
 * @module
 * @since 0.16.0
 */

export type {
  ActiveEditor,
  DocumentPresence,
  InlineEditManager,
} from "./types.ts";
