/**
 * Request body size gate.
 *
 * `req.formData()` / `req.json()` / `req.arrayBuffer()` all buffer the full
 * request body before any per-field or per-file cap is applied. Without an
 * upfront check a client can stream a multi-hundred-MB multipart body and
 * force Dune to allocate it all — a cheap memory DoS.
 *
 * Two layers of defence are provided:
 *
 * 1. `checkBodySize()` — checks `Content-Length` before any parsing. Fast and
 *    free, but spoofable and ineffective against chunked transfers.
 *
 * 2. `limitedBody()` — wraps the raw `Request.body` stream in a byte counter
 *    that throws `BodyTooLargeError` as soon as `maxBytes` is exceeded,
 *    regardless of how the body is framed. Use this for paths where chunked
 *    uploads are a realistic concern.
 */

export class BodyTooLargeError extends Error {
  readonly status = 413;
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

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

/**
 * Wrap a `ReadableStream<Uint8Array>` so that reading more than `maxBytes`
 * total throws `BodyTooLargeError`. Pass the returned stream to
 * `new Response(stream).formData()` (or `.arrayBuffer()` / `.text()`) to get
 * a streaming size limit that works for both Content-Length and chunked
 * transfers.
 *
 * Usage:
 *   const body = limitedBody(req.body, maxBytes);
 *   const formData = await new Response(body, {
 *     headers: { "content-type": req.headers.get("content-type") ?? "" },
 *   }).formData();
 */
export function limitedBody(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): ReadableStream<Uint8Array> {
  if (!stream) return new ReadableStream({ start(c) { c.close(); } });

  let total = 0;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new BodyTooLargeError(maxBytes));
        } else {
          controller.enqueue(chunk);
        }
      },
    }),
  );
}
