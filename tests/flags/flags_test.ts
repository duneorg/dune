import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { flag, initFlags, allFlags } from "../../src/flags/mod.ts";

Deno.test("flag: returns false for unknown flag", () => {
  initFlags({});
  assertEquals(flag("nonexistent"), false);
});

Deno.test("flag: static true", () => {
  initFlags({ comments: true });
  assertEquals(flag("comments"), true);
});

Deno.test("flag: static false", () => {
  initFlags({ comments: false });
  assertEquals(flag("comments"), false);
});

Deno.test("flag: env:VAR when var is set to '1'", () => {
  Deno.env.set("_TEST_FLAG_ONE", "1");
  initFlags({ beta: "env:_TEST_FLAG_ONE" });
  assertEquals(flag("beta"), true);
  Deno.env.delete("_TEST_FLAG_ONE");
});

Deno.test("flag: env:VAR when var is set to 'true'", () => {
  Deno.env.set("_TEST_FLAG_TRUE", "true");
  initFlags({ beta: "env:_TEST_FLAG_TRUE" });
  assertEquals(flag("beta"), true);
  Deno.env.delete("_TEST_FLAG_TRUE");
});

Deno.test("flag: env:VAR when var is set to 'yes'", () => {
  Deno.env.set("_TEST_FLAG_YES", "yes");
  initFlags({ beta: "env:_TEST_FLAG_YES" });
  assertEquals(flag("beta"), true);
  Deno.env.delete("_TEST_FLAG_YES");
});

Deno.test("flag: env:VAR when var is set to '0'", () => {
  Deno.env.set("_TEST_FLAG_ZERO", "0");
  initFlags({ beta: "env:_TEST_FLAG_ZERO" });
  assertEquals(flag("beta"), false);
  Deno.env.delete("_TEST_FLAG_ZERO");
});

Deno.test("flag: env:VAR when var is unset", () => {
  Deno.env.delete("_TEST_FLAG_UNSET");
  initFlags({ beta: "env:_TEST_FLAG_UNSET" });
  assertEquals(flag("beta"), false);
});

Deno.test("flag: multiple flags coexist", () => {
  initFlags({ a: true, b: false, c: true });
  assertEquals(flag("a"), true);
  assertEquals(flag("b"), false);
  assertEquals(flag("c"), true);
});

Deno.test("allFlags: returns snapshot of all flags", () => {
  initFlags({ x: true, y: false });
  const all = allFlags();
  assertEquals(all, { x: true, y: false });
});

Deno.test("initFlags: subsequent call resets previous state", () => {
  initFlags({ old: true });
  initFlags({ new: true });
  assertEquals(flag("old"), false);
  assertEquals(flag("new"), true);
});

Deno.test("initFlags: empty call clears all flags", () => {
  initFlags({ comments: true });
  initFlags();
  assertEquals(flag("comments"), false);
});
