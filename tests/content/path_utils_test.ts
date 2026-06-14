/**
 * Tests for content path utilities.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseFolderName,
  parseContentFilename,
  sourcePathToRoute,
  calculateDepth,
  getParentPath,
  isContentFile,
  isMediaFile,
  isMetadataFile,
  isInDraftsFolder,
  isInModuleFolder,
  isNonReservedFlatFile,
  isFlatContentFile,
  RESERVED_STEMS,
} from "../../src/content/path-utils.ts";

// === parseFolderName tests ===

Deno.test("parseFolderName: numeric prefix", () => {
  const info = parseFolderName("01.blog");
  assertEquals(info.order, 1);
  assertEquals(info.slug, "blog");
  assertEquals(info.isModule, false);
  assertEquals(info.isDraft, false);
});

Deno.test("parseFolderName: high numeric prefix", () => {
  const info = parseFolderName("99.misc");
  assertEquals(info.order, 99);
  assertEquals(info.slug, "misc");
});

Deno.test("parseFolderName: plain folder", () => {
  const info = parseFolderName("about");
  assertEquals(info.order, 0);
  assertEquals(info.slug, "about");
  assertEquals(info.isModule, false);
});

Deno.test("parseFolderName: module prefix", () => {
  const info = parseFolderName("_sidebar");
  assertEquals(info.order, 0);
  assertEquals(info.slug, "sidebar");
  assertEquals(info.isModule, true);
  assertEquals(info.isDraft, false);
});

Deno.test("parseFolderName: drafts folder", () => {
  const info = parseFolderName("_drafts");
  assertEquals(info.isDraft, true);
  assertEquals(info.isModule, false);
});

// === parseContentFilename tests ===

Deno.test("parseContentFilename: markdown file", () => {
  const info = parseContentFilename("post.md");
  assertEquals(info!.template, "post");
  assertEquals(info!.format, "md");
  assertEquals(info!.ext, ".md");
});

Deno.test("parseContentFilename: tsx file", () => {
  const info = parseContentFilename("page.tsx");
  assertEquals(info!.template, "self");
  assertEquals(info!.format, "tsx");
});

Deno.test("parseContentFilename: mdx file", () => {
  const info = parseContentFilename("tutorial.mdx");
  assertEquals(info!.template, "tutorial");
  assertEquals(info!.format, "mdx");
});

Deno.test("parseContentFilename: non-content file returns null", () => {
  assertEquals(parseContentFilename("cover.jpg"), null);
  assertEquals(parseContentFilename("data.json"), null);
  assertEquals(parseContentFilename("readme"), null);
});

// === sourcePathToRoute tests ===

Deno.test("sourcePathToRoute: home folder returns natural /home/ route", () => {
  const route = sourcePathToRoute("01.home/default.md");
  assertEquals(route, "/home/"); // Page-folder gets trailing slash; resolver maps to "/"
});

Deno.test("sourcePathToRoute: efficiency folder returns /efficiency/", () => {
  const route = sourcePathToRoute("01.efficiency/default.md");
  assertEquals(route, "/efficiency/");
});

Deno.test("sourcePathToRoute: nested page", () => {
  const route = sourcePathToRoute("02.blog/01.hello-world/post.md");
  assertEquals(route, "/blog/hello-world/");
});

Deno.test("sourcePathToRoute: plain folder", () => {
  const route = sourcePathToRoute("about/default.md");
  assertEquals(route, "/about/");
});

Deno.test("sourcePathToRoute: module returns null", () => {
  const route = sourcePathToRoute("_sidebar/item.md");
  assertEquals(route, null);
});

Deno.test("sourcePathToRoute: drafts returns null", () => {
  const route = sourcePathToRoute("_drafts/unpublished/post.md");
  assertEquals(route, null);
});

Deno.test("sourcePathToRoute: frontmatter slug override", () => {
  const route = sourcePathToRoute("02.blog/01.hello-world/post.md", "custom-slug");
  assertEquals(route, "/blog/custom-slug/");
});

// Flat content files: non-reserved stem in a plain (non-numeric) parent folder

Deno.test("sourcePathToRoute: flat content file routes by stem (no trailing slash)", () => {
  assertEquals(sourcePathToRoute("articles/my-article.md"), "/articles/my-article");
});

Deno.test("sourcePathToRoute: flat content file with slug override", () => {
  assertEquals(sourcePathToRoute("articles/my-article.md", "custom-slug"), "/articles/custom-slug");
});

Deno.test("sourcePathToRoute: reserved stem in plain folder routes to folder (trailing slash)", () => {
  assertEquals(sourcePathToRoute("articles/default.md"), "/articles/");
  assertEquals(sourcePathToRoute("articles/index.md"), "/articles/");
});

Deno.test("sourcePathToRoute: numeric-prefixed parent suppresses flat routing", () => {
  // "02.blog" has numeric prefix → post.md is a template selector, not a flat page
  assertEquals(sourcePathToRoute("02.blog/post.md"), "/blog/");
});

Deno.test("sourcePathToRoute: nested flat archive directory", () => {
  // plain parent "2024" inside plain "articles" → flat routing applies
  assertEquals(sourcePathToRoute("articles/2024/my-article.md"), "/articles/2024/my-article");
  assertEquals(sourcePathToRoute("articles/2024/default.md"), "/articles/2024/");
});

// === isNonReservedFlatFile tests ===

Deno.test("isNonReservedFlatFile: flat content file", () => {
  assertEquals(isNonReservedFlatFile("articles/my-article.md"), true);
  assertEquals(isNonReservedFlatFile("posts/some-post.md"), true);
});

Deno.test("isNonReservedFlatFile: reserved stems are not flat", () => {
  assertEquals(isNonReservedFlatFile("articles/default.md"), false);
  assertEquals(isNonReservedFlatFile("articles/index.md"), false);
});

Deno.test("isNonReservedFlatFile: numeric parent suppresses flat routing", () => {
  assertEquals(isNonReservedFlatFile("02.blog/post.md"), false);
  assertEquals(isNonReservedFlatFile("02.blog/01.hello-world/post.md"), false);
});

Deno.test("isNonReservedFlatFile: numeric-prefixed stem is not flat-file (handled by classic flat convention)", () => {
  assertEquals(isNonReservedFlatFile("articles/01.my-article.md"), false);
});

Deno.test("isNonReservedFlatFile: root-level file is not flat", () => {
  assertEquals(isNonReservedFlatFile("default.md"), false);
});

Deno.test("RESERVED_STEMS contains expected values", () => {
  assertEquals(RESERVED_STEMS.has("default"), true);
  assertEquals(RESERVED_STEMS.has("index"), true);
  assertEquals(RESERVED_STEMS.has("post"), false);
});

// === calculateDepth tests ===

Deno.test("calculateDepth: top-level page", () => {
  assertEquals(calculateDepth("01.home/default.md"), 0);
});

Deno.test("calculateDepth: nested page", () => {
  assertEquals(calculateDepth("02.blog/01.hello/post.md"), 1);
});

// === isFlatContentFile — template-name routing ===

Deno.test("isFlatContentFile: without templateNames, non-reserved stem in plain folder is flat", () => {
  assertEquals(isFlatContentFile("articles/my-article.md"), true);
  assertEquals(isFlatContentFile("dossiers/ewr.md"), true);
});

Deno.test("isFlatContentFile: templateNames match → template selector, not flat", () => {
  const ctx = { templateNames: new Set(["post", "article"]) };
  // stem "post" is in templateNames → not a flat file (template selector for blog/my-post/)
  assertEquals(isFlatContentFile("blog/my-post/post.md", ctx), false);
});

Deno.test("isFlatContentFile: unmatched stem with templateNames → flat", () => {
  const ctx = { templateNames: new Set(["post", "article"]) };
  // "ewr" not in templateNames → still flat
  assertEquals(isFlatContentFile("dossiers/ewr.md", ctx), true);
  // "first" not in templateNames → flat
  assertEquals(isFlatContentFile("articles/first.md", ctx), true);
});

Deno.test("sourcePathToRoute: Grav-style page folder with templateNames", () => {
  const ctx = { templateNames: new Set(["post", "article"]) };
  assertEquals(sourcePathToRoute("blog/my-post/post.md", undefined, ctx), "/blog/my-post/");
  assertEquals(sourcePathToRoute("news/breaking/article.md", undefined, ctx), "/news/breaking/");
});

Deno.test("sourcePathToRoute: flat file unaffected when stem not in templateNames", () => {
  const ctx = { templateNames: new Set(["post", "article"]) };
  assertEquals(sourcePathToRoute("dossiers/ewr.md", undefined, ctx), "/dossiers/ewr");
  assertEquals(sourcePathToRoute("articles/first.md", undefined, ctx), "/articles/first");
});

Deno.test("calculateDepth: deep page", () => {
  assertEquals(calculateDepth("a/b/c/d/post.md"), 3);
});

// === getParentPath tests ===

Deno.test("getParentPath: top-level has no parent", () => {
  assertEquals(getParentPath("01.home/default.md"), null);
});

Deno.test("getParentPath: nested page", () => {
  assertEquals(getParentPath("02.blog/01.hello/post.md"), "02.blog");
});

// === File type checks ===

Deno.test("isContentFile: recognizes content extensions", () => {
  assertEquals(isContentFile("post.md"), true);
  assertEquals(isContentFile("page.tsx"), true);
  assertEquals(isContentFile("tutorial.mdx"), true);
  assertEquals(isContentFile("cover.jpg"), false);
  assertEquals(isContentFile("data.json"), false);
});

Deno.test("isMediaFile: recognizes media extensions", () => {
  assertEquals(isMediaFile("cover.jpg"), true);
  assertEquals(isMediaFile("photo.png"), true);
  assertEquals(isMediaFile("video.mp4"), true);
  assertEquals(isMediaFile("post.md"), false);
});

Deno.test("isMetadataFile: recognizes sidecar files", () => {
  assertEquals(isMetadataFile("cover.jpg.meta.yaml"), true);
  assertEquals(isMetadataFile("page.frontmatter.yaml"), true);
  assertEquals(isMetadataFile("post.md"), false);
});

Deno.test("isInDraftsFolder: detects _drafts", () => {
  assertEquals(isInDraftsFolder("_drafts/post/default.md"), true);
  assertEquals(isInDraftsFolder("02.blog/_drafts/post/post.md"), true);
  assertEquals(isInDraftsFolder("02.blog/post.md"), false);
});

Deno.test("isInModuleFolder: detects module folders", () => {
  assertEquals(isInModuleFolder("_sidebar/item.md"), true);
  assertEquals(isInModuleFolder("page/_hero/section.md"), true);
  assertEquals(isInModuleFolder("02.blog/post.md"), false);
  // _drafts is not a module
  assertEquals(isInModuleFolder("_drafts/post.md"), false);
});
