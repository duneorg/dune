/**
 * Inherited and site-default page gating (#157): own `roles:` → nearest
 * ancestor's → `site.auth.default_roles`, with `roles: public` as an opt-out.
 */
import {
  assertEquals,
  assertStrictEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applyGatingInheritance } from "../../src/content/index-builder.ts";
import type { PageIndex } from "../../src/content/types.ts";

/** Minimal index entry: only the fields the inheritance pass reads. */
function page(
  sourcePath: string,
  ownRoles?: unknown,
  language = "en",
): PageIndex {
  const parts = sourcePath.split("/");
  const dirs = parts.slice(0, -1);
  const stem = parts[parts.length - 1];
  const flat = /^\d+\./.test(stem);
  // Mirrors getParentPath: a flat file's parent is its own folder.
  const parentPath = flat
    ? (dirs.join("/") || null)
    : (dirs.length > 1 ? dirs.slice(0, -1).join("/") : null);
  return {
    sourcePath,
    language,
    parentPath,
    ownRoles,
    roles: ownRoles,
    gated: ownRoles !== undefined,
  } as unknown as PageIndex;
}

function state(p: PageIndex) {
  return { gated: p.gated, roles: p.roles };
}

Deno.test("gating: nothing declared anywhere → public", () => {
  const p = page("01.home/default.md");
  applyGatingInheritance([p], undefined);
  assertEquals(state(p), { gated: false, roles: undefined });
});

Deno.test("gating: a page's own roles apply", () => {
  const p = page("01.members/default.md", "member");
  applyGatingInheritance([p], undefined);
  assertEquals(state(p), { gated: true, roles: "member" });
});

Deno.test("gating: children and grandchildren inherit the parent's roles", () => {
  const section = page("02.about/default.md", "member");
  const child = page("02.about/01.team/default.md");
  const grand = page("02.about/01.team/01.bios/default.md");
  const other = page("03.contact/default.md");
  applyGatingInheritance([section, child, grand, other], undefined);
  assertEquals(state(child), { gated: true, roles: "member" });
  assertEquals(state(grand), { gated: true, roles: "member" });
  assertEquals(state(other), { gated: false, roles: undefined });
});

Deno.test("gating: the nearest ancestor wins over a further one", () => {
  const top = page("02.about/default.md", "member");
  const mid = page("02.about/01.team/default.md", ["staff"]);
  const leaf = page("02.about/01.team/01.bios/default.md");
  applyGatingInheritance([top, mid, leaf], undefined);
  assertEquals(state(leaf), { gated: true, roles: ["staff"] });
});

Deno.test("gating: a child's own roles beat the parent's", () => {
  const top = page("02.about/default.md", "member");
  const child = page("02.about/01.team/default.md", "admin");
  applyGatingInheritance([top, child], undefined);
  assertEquals(state(child), { gated: true, roles: "admin" });
});

Deno.test("gating: `roles: public` opts a page out of an ancestor's gate", () => {
  const top = page("02.about/default.md", "member");
  const open = page("02.about/01.press/default.md", "public");
  const sub = page("02.about/01.press/01.kit/default.md");
  applyGatingInheritance([top, open, sub], undefined);
  assertEquals(state(open), { gated: false, roles: undefined });
  assertEquals(state(sub), { gated: false, roles: undefined }); // section opt-out
});

Deno.test("gating: site default gates every page that says nothing", () => {
  const a = page("01.home/default.md");
  const b = page("02.about/01.team/default.md");
  applyGatingInheritance([a, b], "any");
  assertEquals(state(a), { gated: true, roles: [] });
  assertEquals(state(b), { gated: true, roles: [] });
});

Deno.test("gating: site default is overridden by an ancestor and by `public`", () => {
  const home = page("01.home/default.md", "public");
  const members = page("02.members/default.md", "member");
  const memberChild = page("02.members/01.docs/default.md");
  applyGatingInheritance([home, members, memberChild], "any");
  assertEquals(state(home), { gated: false, roles: undefined });
  assertEquals(state(memberChild), { gated: true, roles: "member" });
});

Deno.test("gating: a list default keeps its roles", () => {
  const p = page("01.home/default.md");
  applyGatingInheritance([p], ["a", "b"]);
  assertEquals(state(p), { gated: true, roles: ["a", "b"] });
});

Deno.test("gating: translations inherit from the section's page in another language", () => {
  const sectionEn = page("02.about/default.md", "member", "en");
  const sectionDe = page("02.about/default.de.md", undefined, "de");
  const childDe = page("02.about/01.team/default.de.md", undefined, "de");
  applyGatingInheritance([sectionEn, sectionDe, childDe], undefined);
  assertEquals(state(childDe), { gated: true, roles: "member" });
});

Deno.test("gating: the same-language section rule beats another language's", () => {
  const sectionEn = page("02.about/default.md", "member", "en");
  const sectionDe = page("02.about/default.de.md", "admin", "de");
  const childDe = page("02.about/01.team/default.de.md", undefined, "de");
  const childEn = page("02.about/01.team/default.md", undefined, "en");
  applyGatingInheritance([sectionEn, sectionDe, childDe, childEn], undefined);
  assertEquals(state(childDe), { gated: true, roles: "admin" });
  assertEquals(state(childEn), { gated: true, roles: "member" });
});

Deno.test("gating: when languages disagree, a gate beats `public` (fails closed)", () => {
  const sectionEn = page("02.about/default.md", "public", "en");
  const sectionDe = page("02.about/default.de.md", "member", "de");
  const childFr = page("02.about/01.team/default.fr.md", undefined, "fr");
  applyGatingInheritance([sectionEn, sectionDe, childFr], undefined);
  assertEquals(state(childFr), { gated: true, roles: "member" });
});

Deno.test("gating: a malformed value inherits instead of opening the page", () => {
  const top = page("02.about/default.md", "member");
  const typo = page("02.about/01.team/default.md", 5);
  const loose = page("03.contact/default.md", 5);
  applyGatingInheritance([top, typo, loose], undefined);
  assertEquals(state(typo), { gated: true, roles: "member" });
  assertEquals(state(loose), { gated: false, roles: undefined });
});

Deno.test("gating: flat sibling files do not set their folder's rule", () => {
  const section = page("03.blog/default.md");
  const gatedPost = page("03.blog/01.secret.md", "member");
  const otherPost = page("03.blog/02.hello.md");
  applyGatingInheritance([section, gatedPost, otherPost], undefined);
  assertEquals(state(gatedPost), { gated: true, roles: "member" });
  assertEquals(state(otherPost), { gated: false, roles: undefined });
});

Deno.test("gating: re-running after a parent changes updates its children", () => {
  const top = page("02.about/default.md", "member");
  const child = page("02.about/01.team/default.md");
  const pages = [top, child];
  applyGatingInheritance(pages, undefined);
  assertEquals(state(child), { gated: true, roles: "member" });

  top.ownRoles = undefined; // the section is opened up
  applyGatingInheritance(pages, undefined);
  assertEquals(state(child), { gated: false, roles: undefined });

  applyGatingInheritance(pages, "any"); // …and now a site default arrives
  assertEquals(state(child), { gated: true, roles: [] });
});

Deno.test("gating: applyGatingInheritance is idempotent", () => {
  const top = page("02.about/default.md", { all: ["a", "b"] });
  const child = page("02.about/01.team/default.md");
  const pages = [top, child];
  applyGatingInheritance(pages, "any");
  const first = pages.map(state);
  applyGatingInheritance(pages, "any");
  assertEquals(pages.map(state), first);
  assertStrictEquals(child.gated, true);
});
