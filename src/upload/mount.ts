/**
 * Upload route mounting.
 *
 * Registers two routes on a Fresh app:
 *   POST /api/upload         — accept a multipart upload and store it
 *   GET  /uploads/{*path}    — serve previously-uploaded files
 *
 * Designed to be called from `mountDuneAdmin()` or directly from a
 * headless Fresh app that wants the upload feature without the full admin panel.
 *
 * @example
 * ```ts
 * import { App } from "fresh";
 * import { mountUploadRoutes } from "@dune/core/upload";
 *
 * const app = new App();
 * mountUploadRoutes(app, { storage, dataDir: "data", requireAuth: false });
 * ```
 */

// deno-lint-ignore no-explicit-any
import type { App } from "fresh";
import type { StorageAdapter } from "../storage/types.ts";
import { createUploadHandler } from "./route.ts";
import { DEFAULT_ALLOWED_MIME_TYPES } from "./handler.ts";
import type { UploadConfig } from "./handler.ts";

export interface UploadMountConfig {
  /** Storage adapter used to read and write upload files. */
  storage: StorageAdapter;
  /**
   * Persistent data directory (e.g. "data").
   * Uploads are stored at `{dataDir}/uploads/...`.
   */
  dataDir: string;
  /**
   * Require an authenticated site user to upload.
   * Derived from `site.uploads.requireAuth` in `site.yaml`.
   * Default: false
   */
  requireAuth: boolean;
  /**
   * Maximum upload size in megabytes.
   * Default: 10
   */
  maxSizeMb?: number;
  /**
   * MIME types permitted for upload.
   * Default: common images (JPEG, PNG, WebP, GIF, AVIF) + PDF.
   */
  allowedTypes?: string[];
  /**
   * Optional token validator for `requireAuth: true` setups.
   * Receives the raw `Authorization` header value (or null).
   * When omitted, any non-empty Bearer token is accepted.
   */
  validateToken?: (authorization: string | null) => boolean | Promise<boolean>;
}

/**
 * Mount public upload routes onto a Fresh app.
 *
 * Registers:
 *   - `POST /api/upload` — generic upload endpoint
 *   - `GET /uploads/{*path}` — serve stored uploads
 *
 * Call this after admin routes are mounted but before the content catch-all,
 * so `/uploads/` requests are handled here rather than falling through to the
 * content router.
 */
export function mountUploadRoutes(
  // deno-lint-ignore no-explicit-any
  app: App<any>,
  config: UploadMountConfig,
): void {
  const { storage, dataDir, requireAuth, validateToken } = config;
  const maxSizeMb = config.maxSizeMb ?? 10;
  const allowedTypes = config.allowedTypes ?? [...DEFAULT_ALLOWED_MIME_TYPES];

  const uploadConfig: UploadConfig = {
    maxSizeMb,
    allowedTypes,
    storageSubpath: "",
    requireAuth,
  };

  const uploadHandler = createUploadHandler({
    config: uploadConfig,
    storage,
    dataDir,
    validateToken,
  });

  // POST /api/upload — generic upload (no subpath)
  app.post("/api/upload", (fc) => uploadHandler(fc.req));

  // GET /uploads/{*path} — serve stored uploads.
  // Files are stored at `{dataDir}/uploads/{path}` by the handler.
  // We serve them from there directly via the storage adapter.
  app.get("/uploads/*", async (fc) => {
    // fc.url.pathname = "/uploads/subdir/filename.jpg"
    const rawPath = fc.url.pathname.slice("/uploads/".length);

    // Guard against path traversal in the URL
    if (!rawPath || rawPath.includes("..") || rawPath.startsWith("/")) {
      return new Response("Not found", { status: 404 });
    }

    const storagePath = `${dataDir}/uploads/${rawPath}`;

    let data: Uint8Array;
    try {
      data = await storage.read(storagePath);
    } catch {
      return new Response("Not found", { status: 404 });
    }

    // Derive MIME from the filename extension (same source-of-truth as upload)
    const ext = rawPath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      "jpg": "image/jpeg",
      "jpeg": "image/jpeg",
      "png": "image/png",
      "gif": "image/gif",
      "webp": "image/webp",
      "avif": "image/avif",
      "pdf": "application/pdf",
      "txt": "text/plain",
      "csv": "text/csv",
      "zip": "application/zip",
      "doc": "application/msword",
      "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "xls": "application/vnd.ms-excel",
      "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "odt": "application/vnd.oasis.opendocument.text",
      "ods": "application/vnd.oasis.opendocument.spreadsheet",
    };
    const contentType = mimeMap[ext] ?? "application/octet-stream";

    return new Response(data as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(data.byteLength),
        // Cache uploaded files aggressively — filenames are UUID-based, so
        // any change produces a different URL. One year is the practical max.
        "Cache-Control": "public, max-age=31536000, immutable",
        // Prevent browsers from sniffing MIME away from the declared type.
        "X-Content-Type-Options": "nosniff",
        // Downloads: non-image files should not render inline.
        ...(contentType.startsWith("image/") || contentType === "application/pdf"
          ? {}
          : { "Content-Disposition": "attachment" }),
      },
    });
  });
}
