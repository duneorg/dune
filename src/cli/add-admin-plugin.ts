/**
 * Adding the admin plugin to `config/site.yaml`'s `plugins:` list.
 *
 * Before 0.36 core loaded `@dune/plugin-admin` itself unless `admin.enabled`
 * was false. It now loads only what `plugins:` lists, so `dune migrate:config`
 * and `dune new` write the entry. Text-based, so comments and formatting
 * survive.
 *
 * @module
 */

import { parse as parseYaml } from "@std/yaml";

/** The specifier written for the admin: a major range, which the plugin pin rule accepts. */
export const ADMIN_PLUGIN_ENTRY_SRC = "jsr:@dune/plugin-admin@^4";

export interface AddAdminResult {
  text: string;
  /** What happened: the entry was added, was already there, or could not be placed safely. */
  outcome: "added" | "present" | "manual";
}

const isAdminEntry = (e: unknown): boolean => {
  const src = typeof e === "string" ? e : (e as { src?: unknown } | null)?.src;
  return typeof src === "string" && /plugin-admin/.test(src);
};

/**
 * Add `- src: jsr:@dune/plugin-admin@^4` to a site.yaml text. `manual` when the
 * `plugins:` value is written in a way that cannot be extended safely (flow
 * style with entries, an anchor, a non-list value).
 */
export function addAdminPluginToText(text: string): AddAdminResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch {
    return { text, outcome: "manual" };
  }
  const doc = (parsed && typeof parsed === "object" && !Array.isArray(parsed))
    ? parsed as Record<string, unknown>
    : {};
  const plugins = doc.plugins;
  if (Array.isArray(plugins) && plugins.some(isAdminEntry)) return { text, outcome: "present" };
  if (plugins !== undefined && plugins !== null && !Array.isArray(plugins)) return { text, outcome: "manual" };

  const entry = `src: ${ADMIN_PLUGIN_ENTRY_SRC}`;
  const lines = text.split("\n");
  const key = lines.findIndex((l) => /^plugins\s*:/.test(l));

  // No `plugins:` key (or an empty/null one): append a block.
  if (key < 0) {
    const body = text.endsWith("\n") || text === "" ? text : text + "\n";
    return { text: `${body}\nplugins:\n  - ${entry}\n`, outcome: "added" };
  }
  const rest = lines[key].replace(/^plugins\s*:/, "").replace(/#.*$/, "").trim();
  if (rest === "[]" || rest === "" && !Array.isArray(plugins)) {
    lines[key] = `plugins:\n  - ${entry}`;
    return { text: lines.join("\n"), outcome: "added" };
  }
  if (rest !== "") return { text, outcome: "manual" }; // flow style with entries, anchors, tags

  // Block list: insert after the last line that belongs to it.
  let last = key;
  let itemIndent: string | null = null;
  for (let i = key + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(#.*)?$/.test(l)) continue; // blank or comment: undecided
    const m = l.match(/^(\s*)-(\s|$)/);
    const indented = /^\s+\S/.test(l);
    if (m && (itemIndent === null || m[1] === itemIndent)) {
      itemIndent ??= m[1];
      last = i;
    } else if (indented && itemIndent !== null) {
      last = i; // a continuation line of an item (`  config:` ...)
    } else {
      break;
    }
  }
  if (itemIndent === null) return { text, outcome: "manual" };
  lines.splice(last + 1, 0, `${itemIndent}- ${entry}`);
  return { text: lines.join("\n"), outcome: "added" };
}
