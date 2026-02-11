/**
 * Tests for buildPageTitle — constructs browser title tag strings.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPageTitle } from "../../src/content/types.ts";

Deno.test("buildPageTitle: title + descriptor + site", () => {
  const page = { frontmatter: { title: "Services", descriptor: "Custom Web Solutions" } };
  assertEquals(buildPageTitle(page, "My Site"), "Services - Custom Web Solutions | My Site");
});

Deno.test("buildPageTitle: title only (no descriptor)", () => {
  const page = { frontmatter: { title: "About" } };
  assertEquals(buildPageTitle(page, "My Site"), "About | My Site");
});

Deno.test("buildPageTitle: no page returns site name", () => {
  assertEquals(buildPageTitle(null, "My Site"), "My Site");
  assertEquals(buildPageTitle(undefined, "My Site"), "My Site");
});

Deno.test("buildPageTitle: empty title returns site name", () => {
  const page = { frontmatter: { title: "" } };
  assertEquals(buildPageTitle(page, "My Site"), "My Site");
});

Deno.test("buildPageTitle: descriptor without title returns site name", () => {
  const page = { frontmatter: { title: "", descriptor: "Something" } };
  assertEquals(buildPageTitle(page, "My Site"), "My Site");
});
