/**
 * Safer YAML parsers for user-supplied content.
 *
 * @std/yaml's default `parse()` uses the "extended" YAML 1.2 schema, which
 * includes implicit conversions (timestamps, !!js/regexp-like types via the
 * standard tags) that aren't useful in our content files and that have
 * historically been the surface for prototype-pollution-adjacent issues
 * (CWE-1321) in YAML libraries.
 *
 * For user-supplied content (page frontmatter, flex object records, media
 * sidecar metadata, theme manifests, form blueprints) we use the "core"
 * schema which restricts types to:
 *   * strings
 *   * integers
 *   * floats
 *   * booleans
 *   * null
 *   * sequences (arrays)
 *   * mappings (objects)
 *
 * That's enough for every CMS use we have, and small enough that even a
 * future CVE in @std/yaml's exotic-tag handling cannot reach us through
 * these call sites.
 *
 * Refs: claudedocs/security-audit-2026-05.md LOW-10 (CWE-1321).
 */

import { parse } from "@std/yaml";

/**
 * Parse user-supplied YAML text using the "core" YAML 1.2 schema. Returns
 * the parsed value (object | array | scalar | null) or null on empty input.
 *
 * Errors propagate to the caller (callers typically wrap in try/catch and
 * fall back to an empty object — that behaviour is unchanged).
 */
export function parseUserYaml(text: string): unknown {
  if (typeof text !== "string" || text.length === 0) return null;
  return parse(text, { schema: "core" });
}
