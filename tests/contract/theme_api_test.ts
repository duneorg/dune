/**
 * `@dune/theme-api` is a leaf package that redeclares the theme contract.
 * These tests keep core and the package from drifting apart. They are mostly
 * compile-time: `deno check` is the assertion; the runtime checks cover the
 * helpers that exist in both places.
 *
 * Two directions (see the plugin-api extraction plan, decision 10):
 *  - what core hands a template is assignable to the package's types;
 *  - a template written against the package's types is accepted by core.
 */

import { assertEquals } from "@std/assert";
import type * as Theme from "@dune/theme-api";
import * as themeHelpers from "@dune/theme-api";
import type {
  Collection,
  Page,
  PageIndex,
  PageTranslation,
  TemplateComponent,
  TemplateProps,
} from "../../src/content/types.ts";
import * as coreHelpers from "../../src/theme-helpers/mod.ts";

// --- core -> package: what core hands out ---------------------------------

const _props = (p: TemplateProps): Theme.TemplateProps => p;
const _page = (p: Page): Theme.Page => p;
const _index = (p: PageIndex): Theme.PageIndex => p;
const _translation = (p: PageTranslation): Theme.PageTranslation => p;
const _collection = (c: Collection): Theme.Collection => c;
const _frontmatter = (f: import("../../src/content/types.ts").PageFrontmatter): Theme.PageFrontmatter => f;
const _config = (c: TemplateProps["config"]): Theme.TemplateConfig => c;
const _site = (s: TemplateProps["site"]): Theme.SiteConfig => s;
const _component = (c: TemplateComponent): Theme.TemplateComponent => c;

// --- package -> core: what a theme hands in -------------------------------

const _themeTemplate: TemplateComponent = (props: Theme.TemplateProps) => props.page.frontmatter.title;
const _themeTemplateWithExtras: TemplateComponent = (
  props: Theme.TemplateProps & { landing?: boolean },
) => props.landing;

void [
  _props,
  _page,
  _index,
  _translation,
  _collection,
  _frontmatter,
  _config,
  _site,
  _component,
  _themeTemplate,
  _themeTemplateWithExtras,
];

// --- the helpers exist in both places and agree ---------------------------

Deno.test("the package's helpers behave like core's", () => {
  const pages = [
    { title: "b", order: 0, date: "2025-03-01" },
    { title: "a", order: 2, date: null },
    { title: "c", order: 1, date: "2026-01-01" },
  ] as unknown as PageIndex[];

  assertEquals(themeHelpers.getSearchUrl("a b", "/x"), coreHelpers.getSearchUrl("a b", "/x"));
  assertEquals(themeHelpers.getCanonicalUrl("https://e.com/", "/p/"), coreHelpers.getCanonicalUrl("https://e.com/", "/p/"));
  assertEquals(themeHelpers.formatDate(0, "en"), coreHelpers.formatDate(0, "en"));
  assertEquals(themeHelpers.truncate("Hello world, how are you?", 15), coreHelpers.truncate("Hello world, how are you?", 15));
  assertEquals(themeHelpers.paginate([1, 2, 3, 4, 5], 2, 2), coreHelpers.paginate([1, 2, 3, 4, 5], 2, 2));
  for (const field of ["title", "date", "order"] as const) {
    assertEquals(themeHelpers.sortPages(pages, field), coreHelpers.sortPages(pages, field));
  }
  assertEquals(themeHelpers.groupByYear(pages), coreHelpers.groupByYear(pages));
  assertEquals(
    themeHelpers.buildPageTitle({ frontmatter: { title: "A", descriptor: "B" } }, "S"),
    coreHelpers.buildPageTitle({ frontmatter: { title: "A", descriptor: "B" } }, "S"),
  );
});

Deno.test("every helper core exports for themes is in the package", () => {
  const coreRuntime = Object.keys(coreHelpers).sort();
  const pkgRuntime = Object.keys(themeHelpers).sort();
  assertEquals(coreRuntime, pkgRuntime);
});
