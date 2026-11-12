/**
 * `@dune/plugin-api` carries its own copy of a few pure helpers so that a
 * plugin can agree with core without importing it. These tests run both copies
 * on the same inputs; if core's rules change, they fail until the package
 * follows.
 */

import { assertEquals } from "@std/assert";
import * as P from "@dune/plugin-api";
import {
  dirPathToRoute,
  isMediaFile,
  parseContentFilename,
} from "../../src/content/path-utils.ts";
import { getMimeType } from "../../src/content/page-loader.ts";
import { buildPageTitle } from "../../src/content/types.ts";
import { isRtl } from "../../src/i18n/rtl.ts";
import { ADMIN_ROLE_RANK, highestAdminRole } from "../../src/auth/authz-schema.ts";

const FILENAMES = [
  "default.md",
  "default.de.md",
  "default.xx.md",
  "default.DE.md",
  "01.my-article.md",
  "01.my-article.de.md",
  "page.tsx",
  "page.de.tsx",
  "post.mdx",
  "photo.jpg",
  "noext",
  ".md",
  "a.b.c.md",
  "02.x.fr.mdx",
];

Deno.test("plugin-api parseContentFilename agrees with core", () => {
  for (const name of FILENAMES) {
    for (const langs of [undefined, [], ["de"], ["en", "de", "fr"]]) {
      assertEquals(
        P.parseContentFilename(name, langs),
        parseContentFilename(name, langs),
        `${name} ${JSON.stringify(langs)}`,
      );
    }
  }
});

Deno.test("plugin-api dirPathToRoute agrees with core", () => {
  for (
    const dir of [
      "",
      ".",
      "04.blog",
      "04.blog/01.post",
      "_modules/hero",
      "plain/dir",
      "01.a/_b/03.c",
      "a//b",
    ]
  ) {
    assertEquals(P.dirPathToRoute(dir), dirPathToRoute(dir), dir);
  }
});

Deno.test("plugin-api isMediaFile and getMimeType agree with core", () => {
  for (
    const name of [
      "a.jpg",
      "a.PNG",
      "a.svg",
      "a.mp3",
      "a.pdf",
      "a.html",
      "a.md",
      "a.tsx",
      "a.unknown",
      "noext",
      "x/y/z.WebP",
      ".hidden",
    ]
  ) {
    assertEquals(P.isMediaFile(name), isMediaFile(name), name);
    assertEquals(P.getMimeType(name), getMimeType(name), name);
  }
});

Deno.test("plugin-api buildPageTitle and isRtl agree with core", () => {
  const pages = [
    null,
    undefined,
    { frontmatter: {} },
    { frontmatter: { title: "A" } },
    { frontmatter: { title: "A", descriptor: "B" } },
    { frontmatter: { title: "", descriptor: "B" } },
  ];
  for (const page of pages) {
    // Core's signature is stricter (a title is required); the helper must
    // still agree for pages missing one.
    const p = page as Parameters<typeof buildPageTitle>[0];
    assertEquals(P.buildPageTitle(p, "Site"), buildPageTitle(p, "Site"));
  }
  for (const lang of ["ar", "ar-SA", "he", "de", "EN-us", "pa", "xx"]) {
    for (const extra of [undefined, [], ["xx"]]) {
      assertEquals(P.isRtl(lang, extra), isRtl(lang, extra), lang);
    }
  }
});

Deno.test("plugin-api role ladder agrees with core", () => {
  assertEquals(P.ADMIN_ROLE_RANK, ADMIN_ROLE_RANK);
  for (
    const roles of [undefined, [], ["member"], ["member", "editor"], [
      "author",
      "admin",
      "editor",
    ]]
  ) {
    assertEquals(P.highestAdminRole(roles), highestAdminRole(roles));
  }
});
