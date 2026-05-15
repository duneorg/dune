/**
 * Unit tests for role-based content gating.
 *
 * Tests parseRolesSpec, checkRoles, and enforceRoles exhaustively.
 * Does NOT test full routing integration — only the pure gating logic.
 */

import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseRolesSpec, checkRoles, enforceRoles } from "../../src/auth/gating.ts";
import type { RolesSpec } from "../../src/auth/gating.ts";
import type { SiteUser } from "../../src/auth/types.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUser(roles: string[]): SiteUser {
  return {
    id: "u1",
    email: "test@example.com",
    name: "Test User",
    provider: "magic",
    roles,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    enabled: true,
  };
}

function makeRequest(url = "http://site.example.com/members-only"): Request {
  return new Request(url);
}

// ── parseRolesSpec ────────────────────────────────────────────────────────────

Deno.test("parseRolesSpec: null returns null (public)", () => {
  assertStrictEquals(parseRolesSpec(null), null);
});

Deno.test("parseRolesSpec: undefined returns null (public)", () => {
  assertStrictEquals(parseRolesSpec(undefined), null);
});

Deno.test("parseRolesSpec: string → single role spec", () => {
  assertEquals(parseRolesSpec("member"), "member");
});

Deno.test("parseRolesSpec: string with surrounding whitespace is trimmed", () => {
  assertEquals(parseRolesSpec("  admin  "), "admin");
});

Deno.test("parseRolesSpec: empty string returns null (public)", () => {
  assertStrictEquals(parseRolesSpec(""), null);
});

Deno.test("parseRolesSpec: string[] → OR list spec", () => {
  assertEquals(parseRolesSpec(["member", "admin"]), ["member", "admin"]);
});

Deno.test("parseRolesSpec: empty array → authenticated-only spec", () => {
  assertEquals(parseRolesSpec([]), []);
});

Deno.test("parseRolesSpec: array filters non-strings", () => {
  assertEquals(parseRolesSpec(["member", 42, null, "admin"]), ["member", "admin"]);
});

Deno.test("parseRolesSpec: { all: [...] } → AND spec", () => {
  assertEquals(parseRolesSpec({ all: ["member", "verified"] }), {
    all: ["member", "verified"],
  });
});

Deno.test("parseRolesSpec: { all: [] } with no valid strings returns null", () => {
  assertStrictEquals(parseRolesSpec({ all: [] }), null);
});

Deno.test("parseRolesSpec: unknown object shape returns null (safe default)", () => {
  assertStrictEquals(parseRolesSpec({ something: "else" }), null);
});

Deno.test("parseRolesSpec: number returns null (safe default)", () => {
  assertStrictEquals(parseRolesSpec(42), null);
});

Deno.test("parseRolesSpec: boolean returns null (safe default)", () => {
  assertStrictEquals(parseRolesSpec(true), null);
});

// ── checkRoles ────────────────────────────────────────────────────────────────

// --- null user ---

Deno.test("checkRoles: null user is always denied (string spec)", () => {
  assertStrictEquals(checkRoles(null, "member"), false);
});

Deno.test("checkRoles: null user is always denied (OR list)", () => {
  assertStrictEquals(checkRoles(null, ["member", "admin"]), false);
});

Deno.test("checkRoles: null user is always denied (empty OR list)", () => {
  assertStrictEquals(checkRoles(null, []), false);
});

Deno.test("checkRoles: null user is always denied (AND spec)", () => {
  assertStrictEquals(checkRoles(null, { all: ["member"] }), false);
});

// --- string spec ---

Deno.test("checkRoles: string spec — user with matching role → granted", () => {
  assertStrictEquals(checkRoles(makeUser(["member", "editor"]), "member"), true);
});

Deno.test("checkRoles: string spec — user without matching role → denied", () => {
  assertStrictEquals(checkRoles(makeUser(["editor"]), "member"), false);
});

Deno.test("checkRoles: string spec — user with no roles → denied", () => {
  assertStrictEquals(checkRoles(makeUser([]), "member"), false);
});

// --- string[] spec (OR) ---

Deno.test("checkRoles: OR spec — user with first matching role → granted", () => {
  assertStrictEquals(checkRoles(makeUser(["member"]), ["member", "admin"]), true);
});

Deno.test("checkRoles: OR spec — user with last matching role → granted", () => {
  assertStrictEquals(checkRoles(makeUser(["admin"]), ["member", "admin"]), true);
});

Deno.test("checkRoles: OR spec — user with no matching role → denied", () => {
  assertStrictEquals(checkRoles(makeUser(["editor"]), ["member", "admin"]), false);
});

Deno.test("checkRoles: OR spec — user with multiple matching roles → granted", () => {
  assertStrictEquals(
    checkRoles(makeUser(["member", "admin"]), ["member", "admin"]),
    true,
  );
});

// --- empty array spec (authenticated-only) ---

Deno.test("checkRoles: empty array — any authenticated user → granted", () => {
  assertStrictEquals(checkRoles(makeUser([]), []), true);
});

Deno.test("checkRoles: empty array — user with roles → granted", () => {
  assertStrictEquals(checkRoles(makeUser(["member"]), []), true);
});

// --- { all: [...] } spec (AND) ---

Deno.test("checkRoles: AND spec — user with all required roles → granted", () => {
  assertStrictEquals(
    checkRoles(makeUser(["member", "verified"]), { all: ["member", "verified"] }),
    true,
  );
});

Deno.test("checkRoles: AND spec — user with extra roles and all required → granted", () => {
  assertStrictEquals(
    checkRoles(makeUser(["member", "verified", "admin"]), { all: ["member", "verified"] }),
    true,
  );
});

Deno.test("checkRoles: AND spec — user missing one required role → denied", () => {
  assertStrictEquals(
    checkRoles(makeUser(["member"]), { all: ["member", "verified"] }),
    false,
  );
});

Deno.test("checkRoles: AND spec — user with no roles → denied", () => {
  assertStrictEquals(checkRoles(makeUser([]), { all: ["member"] }), false);
});

Deno.test("checkRoles: AND spec — user with none of the required roles → denied", () => {
  assertStrictEquals(
    checkRoles(makeUser(["admin"]), { all: ["member", "verified"] }),
    false,
  );
});

// ── enforceRoles (async — uses authz.check() or falls back to checkRoles) ─────

Deno.test("enforceRoles: null user + spec → 302 redirect to /auth/login", async () => {
  const req = makeRequest("http://site.example.com/members-only");
  const resp = await enforceRoles(req, null, "member");
  assertEquals(resp?.status, 302);
  assertEquals(
    resp?.headers.get("Location"),
    "/auth/login?next=%2Fmembers-only",
  );
});

Deno.test("enforceRoles: null user + spec with query string → next includes query", async () => {
  const req = makeRequest("http://site.example.com/page?foo=bar");
  const resp = await enforceRoles(req, null, "member");
  assertEquals(resp?.status, 302);
  assertEquals(
    resp?.headers.get("Location"),
    "/auth/login?next=%2Fpage%3Ffoo%3Dbar",
  );
});

Deno.test("enforceRoles: authenticated user lacking roles → 403", async () => {
  const req = makeRequest();
  const resp = await enforceRoles(req, makeUser(["editor"]), "member");
  assertEquals(resp?.status, 403);
  assertEquals(resp?.headers.get("Content-Type"), "text/plain; charset=utf-8");
});

Deno.test("enforceRoles: authenticated user with sufficient role → null (granted)", async () => {
  const req = makeRequest();
  const resp = await enforceRoles(req, makeUser(["member"]), "member");
  assertStrictEquals(resp, null);
});

Deno.test("enforceRoles: authenticated user satisfies OR spec → null (granted)", async () => {
  const req = makeRequest();
  const resp = await enforceRoles(req, makeUser(["admin"]), ["member", "admin"]);
  assertStrictEquals(resp, null);
});

Deno.test("enforceRoles: authenticated user satisfies AND spec → null (granted)", async () => {
  const req = makeRequest();
  const resp = await enforceRoles(req, makeUser(["member", "verified"]), {
    all: ["member", "verified"],
  });
  assertStrictEquals(resp, null);
});

Deno.test("enforceRoles: authenticated user fails AND spec → 403", async () => {
  const req = makeRequest();
  const resp = await enforceRoles(req, makeUser(["member"]), {
    all: ["member", "verified"],
  });
  assertEquals(resp?.status, 403);
});

Deno.test("enforceRoles: authenticated user on empty-array spec → null (granted)", async () => {
  const req = makeRequest();
  const resp = await enforceRoles(req, makeUser([]), []);
  assertStrictEquals(resp, null);
});

Deno.test("enforceRoles: null user on empty-array spec → 302 (not authenticated)", async () => {
  const req = makeRequest();
  const resp = await enforceRoles(req, null, []);
  assertEquals(resp?.status, 302);
});
