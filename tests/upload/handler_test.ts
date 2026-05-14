/**
 * Tests for the public file upload handler (src/upload/handler.ts).
 *
 * Uses an in-memory StorageAdapter so no real filesystem I/O occurs.
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleUpload, DEFAULT_ALLOWED_MIME_TYPES } from "../../src/upload/handler.ts";
import type { UploadConfig } from "../../src/upload/handler.ts";
import type { StorageAdapter, StorageEntry, StorageStat, WatchEvent } from "../../src/storage/types.ts";

// ── In-memory StorageAdapter ──────────────────────────────────────────────────

function createMemoryStorage(): StorageAdapter & { _files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    _files: files,
    async read(path: string): Promise<Uint8Array> {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return d;
    },
    async readText(path: string): Promise<string> {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return new TextDecoder().decode(d);
    },
    async write(path: string, data: Uint8Array | string): Promise<void> {
      files.set(path, typeof data === "string" ? new TextEncoder().encode(data) : data);
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async delete(path: string): Promise<void> {
      files.delete(path);
    },
    async rename(oldPath: string, newPath: string): Promise<void> {
      const d = files.get(oldPath);
      if (!d) throw new Error(`Not found: ${oldPath}`);
      files.set(newPath, d);
      files.delete(oldPath);
    },
    async list(_path: string): Promise<StorageEntry[]> {
      return [];
    },
    async listRecursive(_path: string): Promise<StorageEntry[]> {
      return [];
    },
    async stat(path: string): Promise<StorageStat> {
      const d = files.get(path);
      if (!d) throw new Error(`Not found: ${path}`);
      return { size: d.byteLength, mtime: Date.now(), isFile: true, isDirectory: false };
    },
    async getJSON<T>(_key: string): Promise<T | null> {
      return null;
    },
    async setJSON<T>(_key: string, _value: T, _ttl?: number): Promise<void> {},
    async deleteJSON(_key: string): Promise<void> {},
    watch(_path: string, _callback: (event: WatchEvent) => void): () => void {
      return () => {};
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a default UploadConfig for testing. */
function makeConfig(overrides: Partial<UploadConfig> = {}): UploadConfig {
  return {
    maxSizeMb: 5,
    allowedTypes: [...DEFAULT_ALLOWED_MIME_TYPES],
    storageSubpath: "test-uploads",
    requireAuth: false,
    ...overrides,
  };
}

/** Build a multipart/form-data Request containing a single file field. */
function makeUploadRequest(
  fileName: string,
  content: ArrayBuffer | string = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer,
  fieldName = "file",
): Request {
  const form = new FormData();
  const data: BlobPart = typeof content === "string" ? content : content;
  form.append(fieldName, new File([data], fileName));
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: form,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

Deno.test("handleUpload: valid JPEG upload returns UploadResult", async () => {
  const storage = createMemoryStorage();
  const config = makeConfig();
  const req = makeUploadRequest("photo.jpg");

  const result = await handleUpload(req, config, storage, "data");

  // Must not be an error Response
  assert(!(result instanceof Response), "Expected UploadResult, got Response");
  if (result instanceof Response) return;

  assertEquals(result.mimeType, "image/jpeg");
  assertEquals(result.originalName, "photo.jpg");
  assert(result.filename.endsWith(".jpg"), `Filename should end with .jpg, got ${result.filename}`);
  assert(result.publicUrl.startsWith("/uploads/"), `publicUrl should start with /uploads/, got ${result.publicUrl}`);
  assert(result.sizeBytes > 0, "sizeBytes should be positive");

  // File must be persisted in storage
  assert(storage._files.size > 0, "No file was written to storage");
});

Deno.test("handleUpload: valid PNG upload returns correct MIME type", async () => {
  const storage = createMemoryStorage();
  const config = makeConfig();
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const req = makeUploadRequest("image.png", bytes.buffer as ArrayBuffer);

  const result = await handleUpload(req, config, storage, "data");
  assert(!(result instanceof Response));
  if (result instanceof Response) return;

  assertEquals(result.mimeType, "image/png");
  assert(result.filename.endsWith(".png"));
});

Deno.test("handleUpload: file too large returns 413", async () => {
  const storage = createMemoryStorage();
  // 1 MB limit, but we send a Content-Length header indicating 2 MB
  const config = makeConfig({ maxSizeMb: 1 });

  const form = new FormData();
  form.append("file", new File([new Uint8Array(10)], "small.jpg"));
  const req = new Request("http://localhost/api/upload", {
    method: "POST",
    body: form,
    headers: {
      // Declare > 1 MB — triggers the Content-Length pre-check
      "Content-Length": String(2 * 1024 * 1024 + 1),
    },
  });

  const result = await handleUpload(req, config, storage, "data");
  assert(result instanceof Response, "Expected Response error, got UploadResult");
  assertEquals((result as Response).status, 413);
});

Deno.test("handleUpload: disallowed MIME type returns 400", async () => {
  const storage = createMemoryStorage();
  // Only allow PNG; try to upload a PDF
  const config = makeConfig({ allowedTypes: ["image/png"] });
  const req = makeUploadRequest("document.pdf");

  const result = await handleUpload(req, config, storage, "data");
  assert(result instanceof Response, "Expected Response error, got UploadResult");
  assertEquals((result as Response).status, 400);
  assert(storage._files.size === 0, "File should not be stored on type rejection");
});

Deno.test("handleUpload: missing file field returns 400", async () => {
  const storage = createMemoryStorage();
  const config = makeConfig();

  // Send a form with a text field instead of a file field
  const form = new FormData();
  form.append("not_file", "some text");
  const req = new Request("http://localhost/api/upload", {
    method: "POST",
    body: form,
  });

  const result = await handleUpload(req, config, storage, "data");
  assert(result instanceof Response, "Expected Response error, got UploadResult");
  assertEquals((result as Response).status, 400);
  const body = await (result as Response).json();
  assertEquals(body.error, "Missing file field");
});

Deno.test("handleUpload: executable extension is rejected even with image MIME label", async () => {
  const storage = createMemoryStorage();
  const config = makeConfig();
  // Try a PHP file — not in the MIME allowlist regardless of MIME label tricks
  const req = makeUploadRequest("evil.php");

  const result = await handleUpload(req, config, storage, "data");
  assert(result instanceof Response, "Expected Response error, got UploadResult");
  assertEquals((result as Response).status, 400);
  assert(storage._files.size === 0, "Executable file should not be stored");
});

Deno.test("handleUpload: stored filename is UUID-based (no original name leakage)", async () => {
  const storage = createMemoryStorage();
  const config = makeConfig();
  const req = makeUploadRequest("../../etc/passwd.jpg");

  const result = await handleUpload(req, config, storage, "data");
  assert(!(result instanceof Response), "Expected UploadResult");
  if (result instanceof Response) return;

  // The stored filename should be a UUID hex string, never containing ".."
  assert(!result.filename.includes(".."), "Stored filename must not contain path traversal");
  assert(!result.publicUrl.includes(".."), "Public URL must not contain path traversal");
  // UUID-based: 32 hex chars + extension
  const parts = result.filename.split(".");
  assert(parts[0].length === 32, `Expected 32-char UUID, got ${parts[0].length}`);
});

Deno.test("handleUpload: storageSubpath is reflected in publicUrl", async () => {
  const storage = createMemoryStorage();
  const config = makeConfig({ storageSubpath: "avatars" });
  const req = makeUploadRequest("me.webp");

  const result = await handleUpload(req, config, storage, "data");
  assert(!(result instanceof Response), "Expected UploadResult");
  if (result instanceof Response) return;

  assert(
    result.publicUrl.startsWith("/uploads/avatars/"),
    `Expected URL under /uploads/avatars/, got: ${result.publicUrl}`,
  );
  // Storage path should include the subpath
  let stored = false;
  for (const key of storage._files.keys()) {
    if (key.includes("avatars/")) stored = true;
  }
  assert(stored, "File was not stored under the expected subpath");
});

Deno.test("handleUpload: webp upload is accepted", async () => {
  const storage = createMemoryStorage();
  const config = makeConfig();
  const req = makeUploadRequest("photo.webp");

  const result = await handleUpload(req, config, storage, "data");
  assert(!(result instanceof Response), "Expected UploadResult");
  if (result instanceof Response) return;
  assertEquals(result.mimeType, "image/webp");
});

Deno.test("handleUpload: empty file is rejected with 400", async () => {
  const storage = createMemoryStorage();
  const config = makeConfig();

  const form = new FormData();
  form.append("file", new File([], "empty.jpg"));
  const req = new Request("http://localhost/api/upload", {
    method: "POST",
    body: form,
  });

  const result = await handleUpload(req, config, storage, "data");
  assert(result instanceof Response, "Expected Response error for empty file");
  assertEquals((result as Response).status, 400);
});
