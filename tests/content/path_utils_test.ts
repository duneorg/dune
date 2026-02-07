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

Deno.test("sourcePathToRoute: simple page", () => {
  const route = sourcePathToRoute("01.home/default.md");
  assertEquals(route, "/home");
});

Deno.test("sourcePathToRoute: nested page", () => {
  const route = sourcePathToRoute("02.blog/01.hello-world/post.md");
  assertEquals(route, "/blog/hello-world");
});

Deno.test("sourcePathToRoute: plain folder", () => {
  const route = sourcePathToRoute("about/default.md");
  assertEquals(route, "/about");
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
  assertEquals(route, "/blog/custom-slug");
});

// === calculateDepth tests ===

Deno.test("calculateDepth: top-level page", () => {
  assertEquals(calculateDepth("01.home/default.md"), 0);
});

Deno.test("calculateDepth: nested page", () => {
  assertEquals(calculateDepth("02.blog/01.hello/post.md"), 1);
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
