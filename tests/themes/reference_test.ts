import { assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join, resolve } from "@std/path";
import {
  assertPinnedThemeSpecifier,
  assertThemeName,
  defaultThemeNameFromSpecifier,
  importKeyForThemeSpecifier,
  isLocalThemePath,
  isRemoteThemeSpecifier,
  normalizeThemeSpecifier,
  resolveThemePackageRoot,
  resolveThemeSpecifier,
} from "../../src/themes/reference.ts";

const FIXTURES = resolve(new URL("../fixtures", import.meta.url).pathname);
const REPO_ROOT = resolve(FIXTURES, "../..");
const BASE_REL = "./tests/fixtures/theme-base";

Deno.test("isRemoteThemeSpecifier: jsr and npm", () => {
  assertEquals(isRemoteThemeSpecifier("jsr:@dune/theme-paper@1.0.0"), true);
  assertEquals(isRemoteThemeSpecifier("npm:some-pkg@1.0.0"), true);
  assertEquals(isRemoteThemeSpecifier("./themes/base"), false);
});

Deno.test("isLocalThemePath: relative and absolute paths", () => {
  assertEquals(isLocalThemePath("./themes/base"), true);
  assertEquals(isLocalThemePath("../other"), true);
  assertEquals(isLocalThemePath("/tmp/theme"), true);
  assertEquals(isLocalThemePath("jsr:@dune/theme-paper@1.0.0"), false);
});

Deno.test("assertThemeName: rejects invalid slugs", () => {
  assertThrows(() => assertThemeName("Bad Name"), Error);
  assertThrows(() => assertThemeName(""), Error);
  assertThemeName("paper");
  assertThemeName("my-brand_v2");
});

Deno.test("assertPinnedThemeSpecifier: requires exact semver", () => {
  assertThrows(
    () => assertPinnedThemeSpecifier("jsr:@dune/theme-paper@^1.0.0"),
    Error,
    "pinned",
  );
  assertPinnedThemeSpecifier("jsr:@dune/theme-paper@1.0.0");
  assertPinnedThemeSpecifier("npm:@scope/pkg@2.1.0");
});

Deno.test("defaultThemeNameFromSpecifier: strips scope and theme- prefix", () => {
  assertEquals(defaultThemeNameFromSpecifier("jsr:@dune/theme-paper@1.0.0"), "paper");
  assertEquals(defaultThemeNameFromSpecifier("npm:some-package@1.0.0"), "some-package");
});

Deno.test("importKeyForThemeSpecifier: maps to import map key", () => {
  assertEquals(
    importKeyForThemeSpecifier("jsr:@dune/theme-paper@1.0.0"),
    "@dune/theme-paper",
  );
});

Deno.test("normalizeThemeSpecifier: trims trailing slashes", () => {
  assertEquals(normalizeThemeSpecifier("jsr:@dune/theme-paper@1.0.0/"), "jsr:@dune/theme-paper@1.0.0");
});

Deno.test("resolveThemePackageRoot: resolves local fixture directory", async () => {
  const root = await resolveThemePackageRoot(BASE_REL, REPO_ROOT);
  assertEquals(root, join(FIXTURES, "theme-base"));
});

Deno.test("resolveThemePackageRoot: rejects directory without theme.yaml", async () => {
  await assertRejects(
    () => resolveThemePackageRoot("./tests/fixtures", REPO_ROOT),
    Error,
    "theme.yaml",
  );
});

Deno.test("resolveThemeSpecifier: passes through remote specifiers", async () => {
  const spec = "jsr:@dune/theme-paper@1.0.0";
  assertEquals(await resolveThemeSpecifier(spec, REPO_ROOT), spec);
});
