/**
 * Theme UI-string translator (`t()`), built from a merged locale map.
 *
 * Contract: `t(key, fallback?)` — when `key` is present in the locale map,
 * always returns it, no warning. When `key` is missing and a `fallback` is
 * given, returns `fallback` — this is the normal, expected path while a
 * theme's locale file is incrementally filled in, not an error. When `key`
 * is missing and no `fallback` is given, there's no good text to show:
 * this is warned once per key (deduped, not per render) and renders as the
 * raw key outside production (a visible, debuggable signal) or as an empty
 * string in production (`DUNE_ENV=production`), never a raw key on a live
 * site.
 *
 * @module
 */

import { logger } from "../core/logger.ts";

const warnedKeys = new Set<string>();

/** Build a `t(key, fallback?)` translator closure over a merged locale map. */
export function createTranslator(
  strings: Record<string, string>,
): (key: string, fallback?: string) => string {
  return (key: string, fallback?: string): string => {
    const value = strings[key];
    if (value !== undefined) return value;
    if (fallback !== undefined) return fallback;

    if (!warnedKeys.has(key)) {
      warnedKeys.add(key);
      logger.warn("i18n.missing_key", { key });
    }
    return Deno.env.get("DUNE_ENV") === "production" ? "" : key;
  };
}
