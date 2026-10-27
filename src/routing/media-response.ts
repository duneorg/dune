/**
 * Build HTTP responses for co-located media, with single-range (RFC 7233)
 * support so <audio>/<video> can seek and Safari/iOS will play at all.
 */

import type { MediaResponse } from "../core/engine.ts";

/** Outcome of parsing a Range header against a known resource size. */
export type ByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Parse a `Range` header value for a resource of `size` bytes.
 *
 * Only a single `bytes=` range is honoured (`a-b`, `a-`, `-n`). Anything
 * malformed, using another unit, or listing several ranges is ignored
 * ("full"), as RFC 7233 §3.1 allows. A syntactically valid range that lies
 * outside the resource is "unsatisfiable" (416).
 */
export function parseByteRange(header: string | null, size: number): ByteRange {
  if (!header) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return { kind: "full" };
  const [, first, last] = match;
  if (first === "" && last === "") return { kind: "full" };

  if (first === "") {
    // Suffix range: the last n bytes.
    const n = Number(last);
    if (!Number.isSafeInteger(n)) return { kind: "full" };
    if (n === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - n), end: size - 1 };
  }

  const start = Number(first);
  if (!Number.isSafeInteger(start)) return { kind: "full" };
  const requestedEnd = last === "" ? Infinity : Number(last);
  if (last !== "" && !Number.isSafeInteger(requestedEnd)) {
    return { kind: "full" };
  }
  if (requestedEnd < start) return { kind: "full" }; // invalid per spec → ignore
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(requestedEnd, size - 1) };
}

/**
 * Turn a {@link MediaResponse} into a Response, honouring a `Range` request
 * header. `baseHeaders` (Content-Type, Cache-Control, sandbox CSP, …) are
 * kept on every variant; Content-Length and range headers are set here.
 */
export function mediaBodyResponse(
  req: Request,
  media: MediaResponse,
  baseHeaders: Record<string, string>,
): Response {
  const headers: Record<string, string> = {
    ...baseHeaders,
    "Accept-Ranges": "bytes",
  };
  const range = parseByteRange(req.headers.get("range"), media.size);

  if (range.kind === "unsatisfiable") {
    headers["Content-Range"] = `bytes */${media.size}`;
    headers["Content-Length"] = "0";
    return new Response(null, { status: 416, headers });
  }

  if (range.kind === "partial") {
    const slice = media.data.subarray(range.start, range.end + 1);
    headers["Content-Range"] =
      `bytes ${range.start}-${range.end}/${media.size}`;
    headers["Content-Length"] = String(slice.byteLength);
    return new Response(slice as BodyInit, { status: 206, headers });
  }

  headers["Content-Length"] = String(media.size);
  return new Response(media.data as BodyInit, { headers });
}
