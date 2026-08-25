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

/** A successful upload content-type check. */
export interface UploadCheckOk {
  ok: true;
  /** Server-derived content-type — safe to store and replay. */
  contentType: string;
}

/** A rejected upload content-type check, with the reason it was rejected. */
export interface UploadCheckRejected {
  ok: false;
  reason: string;
}

/** Result of validating an uploaded file's content-type. */
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

/**
 * Verify that a file's leading bytes match the claimed MIME type (magic-byte
 * sniffing). Guards against polyglot files — e.g. an HTML/JS payload renamed
 * to `.gif` and later replayed with an image content-type, or a ZIP-based
 * Office document that is actually arbitrary data.
 *
 * Checked types: JPEG, PNG, GIF, WEBP, AVIF, PDF, and ZIP-based formats
 * (.docx/.xlsx/.odt/.ods all start with the ZIP local-file-header). Plain
 * text formats (.txt/.csv/.doc/.xls) return true — their content models are
 * too loose for a meaningful signature check.
 *
 * Returns true when the type cannot be checked or matches; false on mismatch.
 */
export function contentMatchesMime(bytes: Uint8Array, mime: string): boolean {
  const startsWith = (sig: number[], offset = 0): boolean =>
    sig.length <= bytes.length - offset &&
    sig.every((b, i) => bytes[offset + i] === b);

  switch (mime) {
    case "image/jpeg":
      return startsWith([0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return startsWith([...new TextEncoder().encode("GIF8")]);
    case "image/webp":
      // RIFF....WEBP
      return startsWith([...new TextEncoder().encode("RIFF")]) &&
        startsWith([...new TextEncoder().encode("WEBP")], 8);
    case "image/avif":
      // ISO BMFF box: ....ftyp + brand starting "avi" at offset 8
      return startsWith([...new TextEncoder().encode("ftyp")], 4) &&
        startsWith([...new TextEncoder().encode("avi")], 8);
    case "application/pdf":
      return startsWith([...new TextEncoder().encode("%PDF-")]);
    case "application/zip":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.oasis.opendocument.text":
    case "application/vnd.oasis.opendocument.spreadsheet":
      return startsWith([0x50, 0x4b, 0x03, 0x04]) || startsWith([0x50, 0x4b, 0x05, 0x06]);
    default:
      // No signature rule for this type — don't reject.
      return true;
  }
}
