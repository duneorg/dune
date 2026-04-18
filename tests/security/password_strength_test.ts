import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkPasswordStrength } from "../../src/security/password-strength.ts";

Deno.test("checkPasswordStrength: accepts a strong password", () => {
  const r = checkPasswordStrength("Correct-Horse-Battery-Staple-9!");
  assert(r.ok);
});

Deno.test("checkPasswordStrength: rejects short passwords", () => {
  const r = checkPasswordStrength("short");
  assertEquals(r.ok, false);
  if (!r.ok) assert(r.reason.includes("12"));
});

Deno.test("checkPasswordStrength: rejects common blocklisted passwords", () => {
  const r = checkPasswordStrength("password1234");
  assertEquals(r.ok, false);
});

Deno.test("checkPasswordStrength: blocklist is case-insensitive", () => {
  const r = checkPasswordStrength("Password1234");
  assertEquals(r.ok, false);
});

Deno.test("checkPasswordStrength: rejects single-character runs", () => {
  const r = checkPasswordStrength("aaaaaaaaaaaa");
  assertEquals(r.ok, false);
});

Deno.test("checkPasswordStrength: rejects sequential patterns", () => {
  const r = checkPasswordStrength("0123456789AB");
  assertEquals(r.ok, false);
});

Deno.test("checkPasswordStrength: rejects non-strings", () => {
  const r = checkPasswordStrength(undefined);
  assertEquals(r.ok, false);
});
