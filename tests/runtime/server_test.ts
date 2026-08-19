/**
 * Tests for src/runtime/server.ts's standalone helper functions:
 *
 * - checkInlineEditPermission() — the pages.update decision behind
 *   /api/inline-edit/ws, dec-identity-unification Phase 5c/7's authz-first
 *   cutover applied to the inline-edit WebSocket handler.
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
  checkInlineEditPermission,
  stripUserHeader,
} from "../../src/runtime/server.ts";
import type { DuneAuthSystem } from "../../src/auth/authz.ts";
import { USER_HEADER } from "../../src/auth/types.ts";

function makeAdminAuth(allowed: boolean) {
  const calls = { hasPermission: 0 };
  return {
    calls,
    hasPermission(_authResult: unknown, _permission: string): boolean {
      calls.hasPermission++;
      return allowed;
    },
  };
}

function makeAuthz(allowed: boolean) {
  const calls = { check: 0 };
  return {
    calls,
    // deno-lint-ignore no-explicit-any
    check(_args: any): Promise<boolean> {
      calls.check++;
      return Promise.resolve(allowed);
    },
  };
}

const authResult = { authenticated: true, user: { id: "u1" } };

Deno.test("checkInlineEditPermission: authz.check() allowing wins even when ROLE_PERMISSIONS would deny", async () => {
  const adminAuth = makeAdminAuth(false);
  const authz = makeAuthz(true);
  const result = await checkInlineEditPermission(
    authz as unknown as DuneAuthSystem,
    adminAuth,
    authResult,
  );
  assertEquals(result, true);
  assertEquals(authz.calls.check, 1);
  assertEquals(adminAuth.calls.hasPermission, 0);
});

Deno.test("checkInlineEditPermission: authz.check() denying wins even when ROLE_PERMISSIONS would allow", async () => {
  const adminAuth = makeAdminAuth(true);
  const authz = makeAuthz(false);
  const result = await checkInlineEditPermission(
    authz as unknown as DuneAuthSystem,
    adminAuth,
    authResult,
  );
  assertEquals(result, false);
  assertEquals(authz.calls.check, 1);
  assertEquals(adminAuth.calls.hasPermission, 0);
});

Deno.test("checkInlineEditPermission: falls back to ROLE_PERMISSIONS when authz is undefined", async () => {
  const adminAuth = makeAdminAuth(true);
  const result = await checkInlineEditPermission(
    undefined,
    adminAuth,
    authResult,
  );
  assertEquals(result, true);
  assertEquals(adminAuth.calls.hasPermission, 1);
});

Deno.test("checkInlineEditPermission: falls back to ROLE_PERMISSIONS denial when authz is undefined", async () => {
  const adminAuth = makeAdminAuth(false);
  const result = await checkInlineEditPermission(
    undefined,
    adminAuth,
    authResult,
  );
  assertEquals(result, false);
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
