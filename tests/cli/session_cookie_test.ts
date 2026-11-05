import { assertEquals } from "@std/assert";
import { hasSessionCookie } from "../../src/cli/admin-bar-inject.ts";

const req = (cookie?: string) => new Request("http://x/", { headers: cookie ? { cookie } : {} });

Deno.test("hasSessionCookie: no Cookie header is never a session", () => {
  assertEquals(hasSessionCookie(req()), false);
  assertEquals(hasSessionCookie(req(), ["dune_session"]), false);
});

Deno.test("hasSessionCookie: undeclared cookie names mean any cookie might be the session", () => {
  assertEquals(hasSessionCookie(req("analytics=1")), true);
});

Deno.test("hasSessionCookie: declared names match exactly, anywhere in the header", () => {
  assertEquals(hasSessionCookie(req("a=1; stub_sid=abc; b=2"), ["stub_sid"]), true);
  assertEquals(hasSessionCookie(req("stub_sid=abc"), ["other", "stub_sid"]), true);
  assertEquals(hasSessionCookie(req("analytics=1"), ["stub_sid"]), false);
  assertEquals(hasSessionCookie(req("xstub_sid=abc"), ["stub_sid"]), false, "not a suffix match");
  assertEquals(hasSessionCookie(req("stub_sid="), ["stub_sid"]), false, "an empty value is not a session");
});

Deno.test("hasSessionCookie: names are matched literally, not as patterns", () => {
  assertEquals(hasSessionCookie(req("abc=1"), ["a.c"]), false);
  assertEquals(hasSessionCookie(req("a.c=1"), ["a.c"]), true);
});
