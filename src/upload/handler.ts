/**
 * Public file upload handler.
 *
 * Validates, size-caps, and type-checks multipart/form-data uploads before
 * writing them to the storage adapter. The caller (route or mount) is
 * responsible for authentication gating when `requireAuth` is true.
 *
 * Security posture:
 *   - `Content-Length` is checked before any body buffering (DoS defence).
 *   - The streaming body counter (`limitedBody`) catches chunked transfers that
 *     omit Content-Length.
 *   - The stored filename is UUID-based — the original name is recorded only in
 *     the returned metadata. This eliminates path traversal and collision risk.
 *   - MIME type is derived from the file extension server-side using
 *     `checkUpload()`; the client's declared type is discarded.
 *   - Only extensions listed in `DEFAULT_UPLOAD_EXTENSIONS` (or the configured
 *     `allowedTypes` subset) are accepted.
 */

import { extname } from "@std/path";
import { encodeHex } from "@std/encoding/hex";
import {
  checkUpload,
  DEFAULT_UPLOAD_EXTENSIONS,
} from "../security/uploads.ts";
import { checkBodySize, limitedBody, BodyTooLargeError } from "../security/body-limit.ts";
import type { StorageAdapter } from "../storage/types.ts";

// Default MIME types accepted when no `allowedTypes` is configured.
// Subset of DEFAULT_UPLOAD_EXTENSIONS focused on common public upload use-cases.
export const DEFAULT_ALLOWED_MIME_TYPES: readonly string[] = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "application/pdf",
]);

export interface UploadConfig {
  /** Maximum allowed upload size in megabytes. Default: 10. */
  maxSizeMb: number;
  /**
   * MIME types permitted for upload.
   * The server derives the actual MIME type from the file extension, so this
   * list is matched against the server-derived type, not the client-supplied one.
   */
  allowedTypes: string[];
  /**
   * Sub-path within the uploads directory where files land.
   * E.g. "user-uploads/avatars" → stored at `{dataDir}/uploads/user-uploads/avatars/{uuid}.ext`
   */
  storageSubpath: string;
  /**
   * When true, the caller must have already verified authentication before
   * calling `handleUpload`. This flag is informational — `handleUpload` itself
   * does not check sessions; the route layer does.
   */
  requireAuth: boolean;
}

export interface UploadResult {
  /** Stored filename — UUID-based, e.g. "a3f2c1d9e7b8f042.webp" */
  filename: string;
  /** Original filename supplied by the client (for display only). */
  originalName: string;
  /** Server-derived MIME type. */
  mimeType: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Public URL at which the uploaded file can be retrieved. */
  publicUrl: string;
}

/**
 * Build the extension→MIME allowlist restricted to the caller's `allowedTypes`.
 *
 * `checkUpload()` works from the file extension; we need to filter the global
 * extension map down to only entries whose MIME value appears in
 * `allowedTypes`. This preserves the server-side MIME derivation logic while
 * honouring the per-endpoint type restriction.
 */
function buildAllowlist(allowedTypes: string[]): Record<string, string> {
  const set = new Set(allowedTypes);
  const result: Record<string, string> = {};
  for (const [ext, mime] of Object.entries(DEFAULT_UPLOAD_EXTENSIONS)) {
    if (set.has(mime)) {
      result[ext] = mime;
    }
  }
  return result;
}

/**
 * Derive a safe extension from a server-verified MIME type.
 * Returns the canonical (first) extension for the MIME type, or "" if unknown.
 *
 * Uses the same extension map as `checkUpload` so the round-trip is consistent:
 * extension → MIME (via checkUpload) → extension (via this function).
 */
function extForMime(mime: string): string {
  // Canonical mapping: prefer shorter/more common extensions.
  const canonical: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/avif": ".avif",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/zip": ".zip",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.ms-excel": ".xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.oasis.opendocument.text": ".odt",
    "application/vnd.oasis.opendocument.spreadsheet": ".ods",
  };
  if (canonical[mime]) return canonical[mime];
  // Fallback: search DEFAULT_UPLOAD_EXTENSIONS for a matching MIME
  for (const [ext, m] of Object.entries(DEFAULT_UPLOAD_EXTENSIONS)) {
    if (m === mime) return ext;
  }
  return "";
}

/**
 * Handle a multipart/form-data upload request.
 *
 * Expects a single `file` field in the form body. Returns an `UploadResult`
 * on success, or a JSON `Response` with an appropriate error status on failure:
 *   - 400 — missing/invalid file or disallowed type
 *   - 413 — body or file too large
 *
 * The route layer is responsible for returning 401 when `config.requireAuth`
 * is set and the request is unauthenticated.
 *
 * Files are stored at `{dataDir}/uploads/{storageSubpath}/{uuid}{ext}`.
 */
export async function handleUpload(
  req: Request,
  config: UploadConfig,
  storage: StorageAdapter,
  dataDir: string,
): Promise<UploadResult | Response> {
  const maxBytes = config.maxSizeMb * 1024 * 1024;

  // Fast-path: reject by Content-Length before buffering.
  const tooLarge = checkBodySize(req, maxBytes);
  if (tooLarge) return tooLarge;

  let formData: FormData;
  try {
    // Streaming size guard covers chunked uploads that omit Content-Length.
    const limited = limitedBody(req.body, maxBytes);
    formData = await new Response(limited, {
      headers: { "content-type": req.headers.get("content-type") ?? "" },
    }).formData();
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return new Response(
        JSON.stringify({ error: "Request too large" }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: "Invalid multipart body" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return new Response(
      JSON.stringify({ error: "Missing file field" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (file.size === 0) {
    return new Response(
      JSON.stringify({ error: "Empty file" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Per-file size check (belt-and-suspenders after the body limit).
  if (file.size > maxBytes) {
    return new Response(
      JSON.stringify({ error: `File too large (max ${config.maxSizeMb} MB)` }),
      { status: 413, headers: { "Content-Type": "application/json" } },
    );
  }

  // Build the restricted extension allowlist from configured MIME types.
  const allowlist = buildAllowlist(config.allowedTypes);
  if (Object.keys(allowlist).length === 0) {
    // All configured MIME types were unrecognized — misconfiguration, fail safe.
    return new Response(
      JSON.stringify({ error: "No allowed file types configured" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Derive the original extension from the submitted filename.
  const originalExt = extname(file.name).toLowerCase();
  const check = checkUpload(file.name, allowlist);
  if (!check.ok) {
    return new Response(
      JSON.stringify({ error: check.reason }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // check.ok is true: mimeType is server-derived and safe.
  const mimeType = check.contentType;

  // Prefer canonical extension for the stored filename; fall back to the
  // original extension which passed the allowlist check.
  const storedExt = extForMime(mimeType) || originalExt;

  // UUID-based filename — eliminates path traversal and collision risk.
  const uuid = encodeHex(crypto.getRandomValues(new Uint8Array(16)));
  const storedFilename = `${uuid}${storedExt}`;

  // Validate storageSubpath against path traversal using a URL-normalisation
  // containment check.
  //
  // The naive replace(/\.\./g, "") approach is bypassable (e.g. "....//foo"
  // becomes "./foo" after the substitution, which still traverses upward).
  // Using URL normalisation resolves all ".." segments canonically.
  const rawSub = config.storageSubpath.replace(/^\/+/, "").replace(/\/+$/, "");
  const uploadsBase = new URL(`${dataDir}/uploads/`, "file:///");
  const candidateRel = rawSub
    ? `${dataDir}/uploads/${rawSub}/${storedFilename}`
    : `${dataDir}/uploads/${storedFilename}`;
  const candidate = new URL(candidateRel, "file:///");

  if (!candidate.pathname.startsWith(uploadsBase.pathname)) {
    return new Response(
      JSON.stringify({ error: "Invalid storage sub-path" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Derive safe paths from the validated URL (pathname starts with "/").
  const storagePath = candidate.pathname.slice(1); // strip leading "/" → relative path
  const publicUrl = `/uploads/${candidate.pathname.slice(uploadsBase.pathname.length)}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  await storage.write(storagePath, bytes);

  return {
    filename: storedFilename,
    originalName: file.name,
    mimeType,
    sizeBytes: bytes.byteLength,
    publicUrl,
  };
}
