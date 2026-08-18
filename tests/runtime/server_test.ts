/**
 * Tests for checkInlineEditPermission() (src/runtime/server.ts) — the
 * pages.update decision behind /api/inline-edit/ws, dec-identity-
 * unification Phase 5c/7's authz-first cutover applied to the inline-edit
 * WebSocket handler. Extracted as a standalone function specifically so
 * this decision is unit-testable without a full app + WebSocket-upgrade
 * harness (createDuneApp() has no lighter-weight seam for this route).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkInlineEditPermission } from "../../src/runtime/server.ts";
import type { DuneAuthSystem } from "../../src/auth/authz.ts";

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
