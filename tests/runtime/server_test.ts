/**
 * Tests for src/runtime/server.ts's standalone helper functions:
 *
 * - assertInlineEditSameOrigin() — the origin gate on /api/inline-edit/*
 *   requests that change something. (The pages.update decision itself lives
 *   in tests/auth/editor_test.ts.)
 * - stripUserHeader() — part of the internal x-dune-user header handling
 *   (dec-identity-unification's User rename); ensures the header is only
 *   ever set by Dune's own middleware, never accepted from an incoming
 *   request.
 *
 * Both are extracted as standalone functions specifically so these
 * decisions are unit-testable without a full app + WebSocket-upgrade
 * harness (createDuneApp() has no lighter-weight seam for either).
 */

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertInlineEditWsOrigin,
  assertInlineEditSameOrigin,
  isIndexedInlineEditPath,
  isSafeInlineEditPath,
  stripUserHeader,
} from "../../src/runtime/server.ts";
import { clientIp, rememberSocketAddr } from "../../src/security/rate-limit.ts";
import { USER_HEADER } from "../../src/auth/types.ts";

// ── assertInlineEditSameOrigin ──────────────────────────────────────────

function req(method: string, headers: Record<string, string> = {}): Request {
  return new Request("https://site.test/api/inline-edit/content/x/commit", { method, headers });
}

Deno.test("assertInlineEditSameOrigin: reads need no origin", () => {
  assertEquals(assertInlineEditSameOrigin(req("GET")), null);
});

Deno.test("assertInlineEditSameOrigin: a write from the same origin passes", () => {
  assertEquals(assertInlineEditSameOrigin(req("POST", { origin: "https://site.test" })), null);
});

Deno.test("assertInlineEditSameOrigin: a write from another origin is refused", () => {
  assertEquals(assertInlineEditSameOrigin(req("PATCH", { origin: "https://evil.test" }))?.status, 403);
});

Deno.test("assertInlineEditSameOrigin: a write without Origin passes only when the browser says same-origin", () => {
  assertEquals(assertInlineEditSameOrigin(req("POST"))?.status, 403);
  assertEquals(assertInlineEditSameOrigin(req("POST", { "sec-fetch-site": "cross-site" }))?.status, 403);
  assertEquals(assertInlineEditSameOrigin(req("POST", { "sec-fetch-site": "same-origin" })), null);
});

// ── stripUserHeader ────────────────────────────────────────────────────

Deno.test("stripUserHeader: removes a client-supplied x-dune-user header", () => {
  const req = new Request("https://example.com/", {
    headers: {
      [USER_HEADER]: JSON.stringify({ id: "someone-else", roles: ["admin"] }),
    },
  });
  const cleaned = stripUserHeader(req);
  assertEquals(cleaned.headers.has(USER_HEADER), false);
});

Deno.test("stripUserHeader: leaves other headers untouched", () => {
  const req = new Request("https://example.com/", {
    headers: {
      [USER_HEADER]: JSON.stringify({ id: "someone-else", roles: ["admin"] }),
      "x-custom": "keep-me",
      "content-type": "application/json",
    },
  });
  const cleaned = stripUserHeader(req);
  assertEquals(cleaned.headers.get("x-custom"), "keep-me");
  assertEquals(cleaned.headers.get("content-type"), "application/json");
});

Deno.test("stripUserHeader: returns the same request instance when the header is absent (no unnecessary reconstruction)", () => {
  const req = new Request("https://example.com/", {
    headers: { "x-custom": "value" },
  });
  const result = stripUserHeader(req);
  assertStrictEquals(result, req);
});

Deno.test("stripUserHeader: keeps the stamped socket address on the cloned request", () => {
  const req = new Request("https://example.com/", {
    headers: { [USER_HEADER]: "{}" },
  });
  rememberSocketAddr(req, { hostname: "203.0.113.9" });
  const cleaned = stripUserHeader(req);
  assertEquals(clientIp(cleaned), "203.0.113.9");
});

Deno.test("assertInlineEditWsOrigin: missing Origin is rejected", async () => {
  const denied = assertInlineEditWsOrigin(
    new Request("https://example.com/api/inline-edit/ws"),
  );
  assertEquals(denied?.status, 403);
  assertEquals(await denied!.text(), "Origin required");
});

Deno.test("assertInlineEditWsOrigin: cross-site Origin is rejected", async () => {
  const denied = assertInlineEditWsOrigin(
    new Request("https://example.com/api/inline-edit/ws", {
      headers: { origin: "https://evil.example" },
    }),
  );
  assertEquals(denied?.status, 403);
  assertEquals(await denied!.text(), "Cross-origin WebSocket rejected");
});

Deno.test("assertInlineEditWsOrigin: same-origin Origin is allowed", () => {
  assertEquals(
    assertInlineEditWsOrigin(
      new Request("https://example.com/api/inline-edit/ws", {
        headers: { origin: "https://example.com" },
      }),
    ),
    null,
  );
});

Deno.test("isSafeInlineEditPath: accepts relative content files and rejects traversal", () => {
  assertEquals(isSafeInlineEditPath("01.home/default.md"), true);
  assertEquals(isSafeInlineEditPath("02.blog/01.post/default.mdx"), true);
  assertEquals(isSafeInlineEditPath("page.tsx"), true);
  assertEquals(isSafeInlineEditPath("../etc/passwd.md"), false);
  assertEquals(isSafeInlineEditPath("foo/../../bar.md"), false);
  assertEquals(isSafeInlineEditPath("no-extension"), false);
  assertEquals(isSafeInlineEditPath(null), false);
});

Deno.test("isIndexedInlineEditPath: requires the path to be a page in the index", () => {
  const pages = [
    { sourcePath: "01.home/default.md" },
    { sourcePath: "02.blog/01.post/default.md" },
  ];
  assertEquals(isIndexedInlineEditPath(pages, "01.home/default.md"), true);
  assertEquals(isIndexedInlineEditPath(pages, "02.blog/01.post/default.md"), true);
  assertEquals(isIndexedInlineEditPath(pages, "03.secret/sidecar.yaml"), false);
  assertEquals(isIndexedInlineEditPath(pages, "planted.md"), false);
  assertEquals(isIndexedInlineEditPath(pages, "../escape.md"), false);
});

Deno.test("stripUserHeader: preserves method, url, and other request properties", () => {
  const req = new Request("https://example.com/path?q=1", {
    method: "POST",
    headers: {
      [USER_HEADER]: JSON.stringify({ id: "someone-else", roles: [] }),
      "content-type": "text/plain",
    },
    body: "hello",
  });
  const cleaned = stripUserHeader(req);
  assertEquals(cleaned.method, "POST");
  assertEquals(cleaned.url, "https://example.com/path?q=1");
  assertEquals(cleaned.headers.has(USER_HEADER), false);
});
