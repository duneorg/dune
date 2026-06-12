/**
 * Scrub `data-dune-*` marker attributes from HTML served to visitors
 * without a valid editing session.
 *
 * Markers (see `src/ui/editable/mod.ts`) are baked into templates, so the
 * rendered HTML carries them for every request. Only editor plugins consume
 * them, and only for authenticated admins — for everyone else they would
 * leak the page's content source path (`data-dune-source`), file-naming
 * conventions, and a "this site has editable regions" fingerprint. The
 * response pipeline therefore strips them from any response that does not
 * belong to a validated editing session (see `response-transforms.ts`).
 *
 * Stripping is tag-scoped: attributes are removed only inside `<tag …>`
 * tokens, so escaped occurrences in visible text — e.g. documentation
 * showing `&lt;div data-dune-body&gt;` in a code block — are never touched.
 * The same regex fidelity limits as the editor plugin's annotation pass
 * apply: a quoted attribute value containing a literal `>` ends the tag
 * match early, and inline `<script>` text that itself contains tag-shaped
 * `data-dune-` markup is treated as markup.
 */

/** Matches a tag token; attribute stripping only happens inside these. */
const TAG_RE = /<[a-zA-Z][^>]*>/g;

/** Matches one `data-dune-*` attribute (valueless, quoted, or unquoted). */
const ATTR_RE = /\s+data-dune-[a-zA-Z0-9_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;

/**
 * Remove all `data-dune-*` attributes from tags in `html`.
 * Returns the input string unchanged (same reference) when it contains no
 * markers, so callers can cheaply detect the no-op case.
 */
export function stripDuneMarkers(html: string): string {
  if (!html.includes("data-dune-")) return html;
  return html.replace(
    TAG_RE,
    (tag) => tag.includes("data-dune-") ? tag.replace(ATTR_RE, "") : tag,
  );
}

/**
 * Return `response` with `data-dune-*` markers stripped from its body.
 * Non-HTML responses pass through untouched.
 */
export async function scrubMarkersFromResponse(response: Response): Promise<Response> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("text/html")) return response;
  const html = await response.text();
  return new Response(stripDuneMarkers(html), {
    status: response.status,
    headers: response.headers,
  });
}
