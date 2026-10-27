/**
 * Marks responses produced by a template with an `output` mode (see
 * `themes/output.ts`): fragments, JSON, XML, text. These are not HTML
 * documents, so the catch-all skips every document-oriented step for them
 * (feed-link and live-reload injection, RTL `dir`, plugin response
 * transforms such as the admin bar). A `WeakSet` rather than a header so
 * nothing internal can leak to a client; the catch-all reads it straight
 * after `contentHandler()` returns, before any later step rebuilds the
 * `Response`.
 *
 * @module
 */

const bare = new WeakSet<Response>();

/** Mark `response` as a bare template output and return it. */
export function markBareResponse(response: Response): Response {
  bare.add(response);
  return response;
}

/** True when `response` came from a template with an `output` mode. */
export function isBareResponse(response: Response): boolean {
  return bare.has(response);
}
