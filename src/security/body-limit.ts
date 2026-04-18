/**
 * Request body size gate.
 *
 * `req.formData()` / `req.json()` / `req.arrayBuffer()` all buffer the full
 * request body before any per-field or per-file cap is applied. Without an
 * upfront check a client can stream a multi-hundred-MB multipart body and
 * force Dune to allocate it all — a cheap memory DoS.
 *
 * `Content-Length` is client-provided and spoofable, but legitimate browsers
 * always set it accurately and the check costs nothing. Requests that lie about
 * the length (or omit it with `Transfer-Encoding: chunked`) are still subject
 * to whatever downstream per-field / per-file limits the handler enforces, so
 * this gate is defence-in-depth rather than the only line of defence.
 */

/**
 * Return a 413 JSON response if the request's declared `Content-Length`
 * exceeds `maxBytes`. Returns `null` when the request is acceptable (including
 * requests with no / non-numeric Content-Length, which are deferred to the
 * downstream parser's own limits).
 */
export function checkBodySize(req: Request, maxBytes: number): Response | null {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    return new Response(JSON.stringify({ error: "Request too large" }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}
