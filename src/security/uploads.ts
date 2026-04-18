/**
 * Form-submission upload hardening.
 *
 * The public form submission path accepts multipart file uploads. Without
 * server-side gating, `file.type` and `file.name` are both attacker-controlled,
 * which means:
 *
 *   - A `.php` or `.sh` could land on disk (not executed by Dune itself, but
 *     a misconfigured outer web server pointing a handler at `data/uploads/`
 *     would turn that into RCE).
 *   - The stored content-type could be forced to `text/html` and replayed on
 *     download, enabling an XSS in the admin's browser if the Content-
 *     Disposition header is ever dropped.
 *
 * This module centralises the server-side extension allowlist and derives
 * the stored content-type from the filename extension alone — the client's
 * `file.type` is discarded.
 */

import { extname } from "@std/path";

/**
 * Default allowlist of extensions accepted by the public form upload handler.
 * Keys are lowercase extensions including the leading dot; values are the
 * content-type stored alongside the file and replayed at download time.
 *
 * Deliberately conservative: common attachment formats (images, PDFs, office
 * docs, text, zip) but no executable scripts, server-side templates, or
 * dynamic web formats (`.php`, `.sh`, `.exe`, `.html`, `.svg`, `.js`, etc.).
 */
export const DEFAULT_UPLOAD_EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
});

export interface UploadCheckOk {
  ok: true;
  /** Server-derived content-type — safe to store and replay. */
  contentType: string;
}

export interface UploadCheckRejected {
  ok: false;
  reason: string;
}

export type UploadCheckResult = UploadCheckOk | UploadCheckRejected;

/**
 * Decide whether an uploaded file is acceptable based on its filename
 * extension. Returns the server-chosen content-type on success.
 *
 * `allowed` lets a blueprint override the default allowlist per form.
 */
export function checkUpload(
  filename: string,
  allowed: Readonly<Record<string, string>> = DEFAULT_UPLOAD_EXTENSIONS,
): UploadCheckResult {
  const ext = extname(filename).toLowerCase();
  if (!ext) {
    return { ok: false, reason: "File has no extension" };
  }
  const contentType = allowed[ext];
  if (!contentType) {
    return { ok: false, reason: `File type not allowed: ${ext}` };
  }
  return { ok: true, contentType };
}
