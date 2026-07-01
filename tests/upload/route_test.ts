/**
 * Tests for the upload route auth gate (src/upload/route.ts).
 *
 * Focus: when requireAuth is on, the handler must fail closed unless a real
 * validateToken is supplied (previously any non-empty Bearer token was accepted).
 */

import { assertEquals } from "@std/assert";
import { createUploadHandler } from "../../src/upload/route.ts";
import type { UploadConfig } from "../../src/upload/handler.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

function noopStorage(): StorageAdapter {
  return {
    read: () => Promise.reject(new Error("not found")),
    readText: () => Promise.reject(new Error("not found")),
    write: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    delete: () => Promise.resolve(),
    rename: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    listRecursive: () => Promise.resolve([]),
    stat: () => Promise.reject(new Error("not found")),
    getJSON: () => Promise.resolve(null),
    setJSON: () => Promise.resolve(),
    deleteJSON: () => Promise.resolve(),
    watch: () => () => {},
  };
}

const config: UploadConfig = {
  maxSizeMb: 5,
  allowedTypes: ["image/png"],
  storageSubpath: "",
  requireAuth: true,
};

function uploadRequest(): Request {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3])], "x.png"));
  return new Request("http://localhost/api/upload", {
    method: "POST",
    body: form,
    headers: { authorization: "Bearer some-token" },
  });
}

Deno.test("upload route: requireAuth without validateToken fails closed (401)", async () => {
  const handler = createUploadHandler({
    config,
    storage: noopStorage(),
    dataDir: "data",
    // no validateToken — must reject rather than accept the bearer token
  });
  const res = await handler(uploadRequest());
  assertEquals(res.status, 401);
});

Deno.test("upload route: validateToken=false rejects (401)", async () => {
  const handler = createUploadHandler({
    config,
    storage: noopStorage(),
    dataDir: "data",
    validateToken: () => false,
  });
  const res = await handler(uploadRequest());
  assertEquals(res.status, 401);
});

Deno.test("upload route: validateToken=true passes the auth gate (not 401)", async () => {
  const handler = createUploadHandler({
    config,
    storage: noopStorage(),
    dataDir: "data",
    validateToken: () => true,
  });
  const res = await handler(uploadRequest());
  // The auth gate passed; downstream handling may still 4xx on content, but
  // it must not be a 401 auth rejection.
  await res.body?.cancel();
  assertEquals(res.status !== 401, true);
});
