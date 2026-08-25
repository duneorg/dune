/**
 * Tests for the api-guard helpers: requireAuth and ownershipError.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ownershipError, requireAuth, USER_HEADER } from "../../src/auth/api-guard.ts";
import type { User } from "../../src/auth/types.ts";

const alice: User = {
  id: "user-alice",
  email: "alice@example.com",
  provider: "local",
  roles: [],
  createdAt: 0,
  updatedAt: 0,
  lastSeenAt: 0,
  enabled: true,
};

function reqWithUser(user: User | null): Request {
  const headers: Record<string, string> = {};
  if (user) headers[USER_HEADER] = JSON.stringify(user);
  return new Request("https://example.com/api/things", { headers });
}

Deno.test("ownershipError: no user returns 401", async () => {
  const res = ownershipError(null, "user-alice");
  assertEquals(res?.status, 401);
});

Deno.test("ownershipError: mismatched owner returns 403", async () => {
  const res = ownershipError(alice, "user-bob");
  assertEquals(res?.status, 403);
});

Deno.test("ownershipError: matching owner returns null", () => {
  assertEquals(ownershipError(alice, "user-alice"), null);
});

Deno.test("ownershipError: missing or malformed owner id is rejected", async () => {
  // Never allow an absent/empty/non-string owner field to match.
  assertEquals(ownershipError(alice, undefined)?.status, 403);
  assertEquals(ownershipError(alice, "")?.status, 403);
  assertEquals(ownershipError(alice, 42)?.status, 403);
});

Deno.test("requireAuth: none mode passes without a user; required mode 401s", async () => {
  const none = await requireAuth(reqWithUser(null), "none");
  assertEquals(none.error, null);

  const required = await requireAuth(reqWithUser(null), "required");
  assertEquals(required.error?.status, 401);

  const ok = await requireAuth(reqWithUser(alice), "required");
  assertEquals(ok.error, null);
  if (!ok.error) assertEquals(ok.user?.id, "user-alice");
});