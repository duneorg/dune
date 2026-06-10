/**
 * Built-in inline editing plugin.
 *
 * Provides the Y.js-backed real-time inline editor (v0.16+).
 * Loaded dynamically by bootstrap unless `inlineEdit: false` is set in
 * site.yaml, so the Y.js dependency chain is only resolved at runtime for
 * sites that actually use it.
 *
 * @module
 * @since 0.17.0
 */

import type { DunePlugin } from "../hooks/types.ts";
import { createInlineEditManager } from "../inline-edit/manager.ts";

const plugin: DunePlugin = {
  name: "inline-edit",
  version: "1.0.0",
  description: "Y.js-backed real-time inline content editing (TipTap WYSIWYG).",
  hooks: {},
  adminServices({ storage, history, dataDir, contentDir }) {
    return {
      inlineEdit: createInlineEditManager({ storage, history, dataDir, contentDir }),
    };
  },
};

export default plugin;
