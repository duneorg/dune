/**
 * ETag generation for content pages.
 *
 * The ETag is derived from lightweight PageIndex metadata — no file I/O.
 * It changes whenever any of: route, title, date, template, format, or
 * language changes.  Body-only edits without metadata changes do not produce
 * a new ETag; the short page-cache TTL handles those cases.
 */

import type { PageIndex } from "../content/types.ts";

/**
 * Compute a quoted ETag string for a PageIndex entry.
 * The result is safe to use directly in `ETag` and `If-None-Match` headers.
 *
 * @example `"a3f2c1d4b5e6f7a8"`
 */
export async function computeEtag(page: PageIndex): Promise<string> {
  const input = [
    page.route,
    page.title,
    page.date ?? "",
    page.template ?? "",
    page.format,
    page.language ?? "",
    page.sourcePath,
  ].join("|");

  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `"${hex}"`;
}

/**
 * Return true when the `If-None-Match` request header matches the given ETag.
 * Handles the `*` wildcard and comma-separated lists.
 */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  return ifNoneMatch.split(",").map((s) => s.trim()).includes(etag);
}
