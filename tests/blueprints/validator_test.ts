/**
 * Tests for the blueprint validator and loader.
 *
 * Covers: type validation, required fields, options constraints,
 * min/max/pattern constraints, inheritance chain, missing blueprint,
 * and the loader's YAML parsing.
 */

import {
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateFrontmatter, resolveBlueprint } from "../../src/blueprints/validator.ts";
import { loadBlueprints } from "../../src/blueprints/loader.ts";
import type {
  BlueprintDefinition,
  BlueprintField,
  BlueprintMap,
} from "../../src/blueprints/types.ts";
import type { PageFrontmatter } from "../../src/content/types.ts";
import type { StorageAdapter } from "../../src/storage/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrontmatter(overrides: Record<string, unknown> = {}): PageFrontmatter {
  return {
    title: "Test Page",
    published: true,
    visible: true,
    taxonomy: {},
    ...overrides,
  };
}

function makeBlueprints(
  defs: Record<string, Partial<BlueprintDefinition>>,
): BlueprintMap {
  const result: BlueprintMap = {};
  for (const [name, def] of Object.entries(defs)) {
    result[name] = {
      title: def.title ?? name,
      fields: def.fields ?? {},
      ...(def.extends ? { extends: def.extends } : {}),
    };
  }
  return result;
}

function field(overrides: Partial<BlueprintField> & { type: BlueprintField["type"] }): BlueprintField {
  return { label: overrides.type, ...overrides };
}

// ---------------------------------------------------------------------------
// validateFrontmatter — basic cases
// ---------------------------------------------------------------------------

Deno.test("validateFrontmatter: returns empty errors when no blueprint for template", () => {
  const blueprints = makeBlueprints({ post: { fields: { date: field({ type: "date", required: true }) } } });
  const errors = validateFrontmatter(makeFrontmatter(), "other", blueprints);
  assertEquals(errors, []);
});

Deno.test("validateFrontmatter: passes when all required fields present and valid", () => {
  const blueprints = makeBlueprints({
    post: {
      fields: {
        date: field({ type: "date", required: true }),
        author: field({ type: "text", required: true }),
      },
    },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ date: "2024-06-15", author: "Alice" }),
    "post",
    blueprints,
  );
  assertEquals(errors, []);
});

Deno.test("validateFrontmatter: passes when optional field absent", () => {
  const blueprints = makeBlueprints({
    post: { fields: { summary: field({ type: "textarea" }) } },
  });
  const errors = validateFrontmatter(makeFrontmatter(), "post", blueprints);
  assertEquals(errors, []);
});

// ---------------------------------------------------------------------------
// Required field checking
// ---------------------------------------------------------------------------

Deno.test("required: error when required field is missing (undefined)", () => {
  const blueprints = makeBlueprints({
    post: { fields: { author: field({ type: "text", required: true }) } },
  });
  const errors = validateFrontmatter(makeFrontmatter(), "post", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "author");
  assertEquals(errors[0].message.includes("required"), true);
});

Deno.test("required: error when required field is null", () => {
  const blueprints = makeBlueprints({
    post: { fields: { date: field({ type: "date", required: true }) } },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ date: null as unknown as string }),
    "post",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "date");
});

Deno.test("required: error when required field is empty string", () => {
  const blueprints = makeBlueprints({
    post: { fields: { author: field({ type: "text", required: true }) } },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ author: "" }),
    "post",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "author");
});

Deno.test("required: multiple missing fields all reported", () => {
  const blueprints = makeBlueprints({
    post: {
      fields: {
        date: field({ type: "date", required: true }),
        author: field({ type: "text", required: true }),
        featured: field({ type: "toggle", required: true }),
      },
    },
  });
  const errors = validateFrontmatter(makeFrontmatter(), "post", blueprints);
  assertEquals(errors.length, 3);
  const fields = errors.map((e) => e.field).sort();
  assertEquals(fields, ["author", "date", "featured"]);
});

// ---------------------------------------------------------------------------
// Type: text / textarea / markdown / color / file
// ---------------------------------------------------------------------------

Deno.test("type text: accepts string", () => {
  const blueprints = makeBlueprints({ p: { fields: { x: field({ type: "text" }) } } });
  assertEquals(validateFrontmatter(makeFrontmatter({ x: "hello" }), "p", blueprints), []);
});

Deno.test("type text: rejects number", () => {
  const blueprints = makeBlueprints({ p: { fields: { x: field({ type: "text" }) } } });
  const errors = validateFrontmatter(makeFrontmatter({ x: 42 }), "p", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].field, "x");
  assertEquals(errors[0].message.includes("string"), true);
});

Deno.test("type color: accepts string", () => {
  const blueprints = makeBlueprints({ p: { fields: { bg: field({ type: "color" }) } } });
  assertEquals(validateFrontmatter(makeFrontmatter({ bg: "#ff0000" }), "p", blueprints), []);
});

// ---------------------------------------------------------------------------
// Type: number
// ---------------------------------------------------------------------------

Deno.test("type number: accepts number", () => {
  const blueprints = makeBlueprints({ p: { fields: { count: field({ type: "number" }) } } });
  assertEquals(validateFrontmatter(makeFrontmatter({ count: 5 }), "p", blueprints), []);
});

Deno.test("type number: accepts zero", () => {
  const blueprints = makeBlueprints({ p: { fields: { count: field({ type: "number" }) } } });
  assertEquals(validateFrontmatter(makeFrontmatter({ count: 0 }), "p", blueprints), []);
});

Deno.test("type number: rejects string", () => {
  const blueprints = makeBlueprints({ p: { fields: { count: field({ type: "number" }) } } });
  const errors = validateFrontmatter(makeFrontmatter({ count: "5" }), "p", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("number"), true);
});

Deno.test("type number: rejects NaN", () => {
  const blueprints = makeBlueprints({ p: { fields: { count: field({ type: "number" }) } } });
  const errors = validateFrontmatter(makeFrontmatter({ count: NaN }), "p", blueprints);
  assertEquals(errors.length, 1);
});

// ---------------------------------------------------------------------------
// Type: toggle
// ---------------------------------------------------------------------------

Deno.test("type toggle: accepts true", () => {
  const blueprints = makeBlueprints({ p: { fields: { active: field({ type: "toggle" }) } } });
  assertEquals(validateFrontmatter(makeFrontmatter({ active: true }), "p", blueprints), []);
});

Deno.test("type toggle: accepts false", () => {
  const blueprints = makeBlueprints({ p: { fields: { active: field({ type: "toggle" }) } } });
  assertEquals(validateFrontmatter(makeFrontmatter({ active: false }), "p", blueprints), []);
});

Deno.test("type toggle: rejects string 'true'", () => {
  const blueprints = makeBlueprints({ p: { fields: { active: field({ type: "toggle" }) } } });
  const errors = validateFrontmatter(makeFrontmatter({ active: "true" }), "p", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("boolean"), true);
});

// ---------------------------------------------------------------------------
// Type: date
// ---------------------------------------------------------------------------

Deno.test("type date: accepts YYYY-MM-DD", () => {
  const blueprints = makeBlueprints({ p: { fields: { d: field({ type: "date" }) } } });
  assertEquals(validateFrontmatter(makeFrontmatter({ d: "2024-03-15" }), "p", blueprints), []);
});

Deno.test("type date: rejects non-date string", () => {
  const blueprints = makeBlueprints({ p: { fields: { d: field({ type: "date" }) } } });
  const errors = validateFrontmatter(makeFrontmatter({ d: "March 15, 2024" }), "p", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("YYYY-MM-DD"), true);
});

Deno.test("type date: rejects impossible date (2024-02-30)", () => {
  const blueprints = makeBlueprints({ p: { fields: { d: field({ type: "date" }) } } });
  const errors = validateFrontmatter(makeFrontmatter({ d: "2024-02-30" }), "p", blueprints);
  assertEquals(errors.length, 1);
});

Deno.test("type date: rejects number", () => {
  const blueprints = makeBlueprints({ p: { fields: { d: field({ type: "date" }) } } });
  const errors = validateFrontmatter(makeFrontmatter({ d: 20240315 }), "p", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("date string"), true);
});

// ---------------------------------------------------------------------------
// Type: select
// ---------------------------------------------------------------------------

Deno.test("type select: accepts valid option key", () => {
  const blueprints = makeBlueprints({
    p: {
      fields: {
        status: field({ type: "select", options: { draft: "Draft", published: "Published" } }),
      },
    },
  });
  assertEquals(
    validateFrontmatter(makeFrontmatter({ status: "draft" }), "p", blueprints),
    [],
  );
});

Deno.test("type select: rejects value not in options", () => {
  const blueprints = makeBlueprints({
    p: {
      fields: {
        status: field({ type: "select", options: { draft: "Draft", published: "Published" } }),
      },
    },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ status: "archived" }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("draft"), true);
  assertEquals(errors[0].message.includes("published"), true);
});

Deno.test("type select: rejects non-string", () => {
  const blueprints = makeBlueprints({
    p: { fields: { status: field({ type: "select", options: { a: "A" } }) } },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ status: 1 }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
});

// ---------------------------------------------------------------------------
// Type: list
// ---------------------------------------------------------------------------

Deno.test("type list: accepts string array", () => {
  const blueprints = makeBlueprints({ p: { fields: { tags: field({ type: "list" }) } } });
  assertEquals(
    validateFrontmatter(makeFrontmatter({ tags: ["a", "b", "c"] }), "p", blueprints),
    [],
  );
});

Deno.test("type list: accepts empty array", () => {
  const blueprints = makeBlueprints({ p: { fields: { tags: field({ type: "list" }) } } });
  assertEquals(
    validateFrontmatter(makeFrontmatter({ tags: [] }), "p", blueprints),
    [],
  );
});

Deno.test("type list: rejects non-array", () => {
  const blueprints = makeBlueprints({ p: { fields: { tags: field({ type: "list" }) } } });
  const errors = validateFrontmatter(
    makeFrontmatter({ tags: "a, b" }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("list"), true);
});

Deno.test("type list: rejects array with non-string items", () => {
  const blueprints = makeBlueprints({ p: { fields: { tags: field({ type: "list" }) } } });
  const errors = validateFrontmatter(
    makeFrontmatter({ tags: ["ok", 42] }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("[1]"), true);
});

// ---------------------------------------------------------------------------
// Constraint: min / max (number)
// ---------------------------------------------------------------------------

Deno.test("number min: passes when value >= min", () => {
  const blueprints = makeBlueprints({
    p: { fields: { n: field({ type: "number", validate: { min: 0 } }) } },
  });
  assertEquals(validateFrontmatter(makeFrontmatter({ n: 0 }), "p", blueprints), []);
});

Deno.test("number min: fails when value < min", () => {
  const blueprints = makeBlueprints({
    p: { fields: { n: field({ type: "number", validate: { min: 1 } }) } },
  });
  const errors = validateFrontmatter(makeFrontmatter({ n: 0 }), "p", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("at least 1"), true);
});

Deno.test("number max: fails when value > max", () => {
  const blueprints = makeBlueprints({
    p: { fields: { n: field({ type: "number", validate: { max: 100 } }) } },
  });
  const errors = validateFrontmatter(makeFrontmatter({ n: 101 }), "p", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("at most 100"), true);
});

// ---------------------------------------------------------------------------
// Constraint: min / max (string length)
// ---------------------------------------------------------------------------

Deno.test("text min length: fails when string too short", () => {
  const blueprints = makeBlueprints({
    p: { fields: { title: field({ type: "text", validate: { min: 5 } }) } },
  });
  const errors = validateFrontmatter(makeFrontmatter({ title: "Hi" }), "p", blueprints);
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("at least 5 characters"), true);
});

Deno.test("text max length: fails when string too long", () => {
  const blueprints = makeBlueprints({
    p: { fields: { title: field({ type: "text", validate: { max: 10 } }) } },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ title: "This title is way too long for the limit" }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("at most 10 characters"), true);
});

// ---------------------------------------------------------------------------
// Constraint: min / max (list length)
// ---------------------------------------------------------------------------

Deno.test("list min: fails when too few items", () => {
  const blueprints = makeBlueprints({
    p: { fields: { tags: field({ type: "list", validate: { min: 2 } }) } },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ tags: ["one"] }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("at least 2 item"), true);
});

Deno.test("list max: fails when too many items", () => {
  const blueprints = makeBlueprints({
    p: { fields: { tags: field({ type: "list", validate: { max: 3 } }) } },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ tags: ["a", "b", "c", "d"] }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("at most 3 item"), true);
});

// ---------------------------------------------------------------------------
// Constraint: pattern
// ---------------------------------------------------------------------------

Deno.test("text pattern: passes when string matches regex", () => {
  const blueprints = makeBlueprints({
    p: { fields: { slug: field({ type: "text", validate: { pattern: "^[a-z-]+$" } }) } },
  });
  assertEquals(
    validateFrontmatter(makeFrontmatter({ slug: "my-slug" }), "p", blueprints),
    [],
  );
});

Deno.test("text pattern: fails when string does not match", () => {
  const blueprints = makeBlueprints({
    p: { fields: { slug: field({ type: "text", validate: { pattern: "^[a-z-]+$" } }) } },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ slug: "My Slug!" }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("pattern"), true);
});

Deno.test("list pattern: fails when any item does not match", () => {
  const blueprints = makeBlueprints({
    p: { fields: { tags: field({ type: "list", validate: { pattern: "^[a-z]+$" } }) } },
  });
  const errors = validateFrontmatter(
    makeFrontmatter({ tags: ["good", "Bad!", "fine"] }),
    "p",
    blueprints,
  );
  assertEquals(errors.length, 1);
  assertEquals(errors[0].message.includes("Bad!"), true);
});

Deno.test("invalid regex pattern: silently ignored (no crash)", () => {
  const blueprints = makeBlueprints({
    p: { fields: { x: field({ type: "text", validate: { pattern: "[invalid" } }) } },
  });
  // Should not throw — invalid regex is silently skipped
  const errors = validateFrontmatter(makeFrontmatter({ x: "anything" }), "p", blueprints);
  assertEquals(errors, []);
});

// ---------------------------------------------------------------------------
// Blueprint inheritance (extends)
// ---------------------------------------------------------------------------

Deno.test("resolveBlueprint: child inherits all parent fields", () => {
  const blueprints = makeBlueprints({
    default: { fields: { title: field({ type: "text", required: true }) } },
    post: { extends: "default", fields: { date: field({ type: "date", required: true }) } },
  });
  const resolved = resolveBlueprint("post", blueprints.post, blueprints, 0);
  assertEquals(Object.keys(resolved.fields).sort(), ["date", "title"]);
});

Deno.test("resolveBlueprint: child field overrides parent field", () => {
  const blueprints = makeBlueprints({
    default: {
      fields: { title: field({ type: "text", required: false }) },
    },
    post: {
      extends: "default",
      fields: { title: field({ type: "text", required: true }) },
    },
  });
  const resolved = resolveBlueprint("post", blueprints.post, blueprints, 0);
  assertEquals(resolved.fields.title.required, true);
});

Deno.test("validateFrontmatter: inherited required field is validated", () => {
  const blueprints = makeBlueprints({
    default: { fields: { title: field({ type: "text", required: true }) } },
    post: { extends: "default", fields: { date: field({ type: "date", required: true }) } },
  });
  // title comes from default (inherited), date from post — both required
  const errors = validateFrontmatter(
    { ...makeFrontmatter(), title: "" } as PageFrontmatter,
    "post",
    blueprints,
  );
  // title is empty (fails required), date is absent (fails required)
  const fieldNames = errors.map((e) => e.field).sort();
  assertEquals(fieldNames.includes("date"), true);
  assertEquals(fieldNames.includes("title"), true);
});

Deno.test("resolveBlueprint: missing parent silently skipped (no crash)", () => {
  const blueprints = makeBlueprints({
    post: { extends: "nonexistent", fields: { date: field({ type: "date" }) } },
  });
  const resolved = resolveBlueprint("post", blueprints.post, blueprints, 0);
  // Own fields still present
  assertEquals(Object.keys(resolved.fields), ["date"]);
});

Deno.test("resolveBlueprint: depth limit stops infinite recursion", () => {
  // Simulate circular extends by crafting blueprints that would loop
  // (resolveBlueprint handles it via MAX_EXTENDS_DEPTH guard)
  const blueprints: BlueprintMap = {
    a: { title: "A", extends: "b", fields: { fa: field({ type: "text" }) } },
    b: { title: "B", extends: "a", fields: { fb: field({ type: "text" }) } },
  };
  // Should not throw — stops at MAX_EXTENDS_DEPTH
  const resolved = resolveBlueprint("a", blueprints.a, blueprints, 0);
  assertNotEquals(resolved, null);
});

// ---------------------------------------------------------------------------
// loadBlueprints — YAML parsing
// ---------------------------------------------------------------------------

function makeStorage(files: Record<string, string>): StorageAdapter {
  const dirs: Record<string, { name: string; isFile: boolean; isDirectory: boolean }[]> = {};
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      const name = parts[i];
      const isFile = i === parts.length - 1;
      if (!dirs[dir]) dirs[dir] = [];
      if (!dirs[dir].find((e) => e.name === name)) {
        dirs[dir].push({ name, isFile, isDirectory: !isFile });
      }
    }
  }
  return {
    list: (dir: string) => Promise.resolve(dirs[dir] ?? []),
    readText: (path: string) => {
      if (path in files) return Promise.resolve(files[path]);
      return Promise.reject(new Error(`Not found: ${path}`));
    },
    exists: (path: string) => Promise.resolve(path in files),
    read: () => Promise.reject(new Error("read not supported")),
    write: () => Promise.reject(new Error("write not supported")),
    stat: () => Promise.reject(new Error("stat not supported")),
    delete: () => Promise.reject(new Error("delete not supported")),
    listRecursive: () => Promise.reject(new Error("listRecursive not supported")),
    writeText: () => Promise.reject(new Error("writeText not supported")),
  } as unknown as StorageAdapter;
}

Deno.test("loadBlueprints: returns empty map when directory missing", async () => {
  const storage = makeStorage({});
  const blueprints = await loadBlueprints(storage, "blueprints");
  assertEquals(blueprints, {});
});

Deno.test("loadBlueprints: parses valid blueprint YAML", async () => {
  const yaml = `
title: Blog Post
fields:
  date:
    type: date
    label: Publication Date
    required: true
  author:
    type: text
    label: Author
    required: false
`;
  const storage = makeStorage({ "blueprints/post.yaml": yaml });
  const blueprints = await loadBlueprints(storage, "blueprints");
  assertEquals("post" in blueprints, true);
  assertEquals(blueprints.post.title, "Blog Post");
  assertEquals(blueprints.post.fields.date.type, "date");
  assertEquals(blueprints.post.fields.date.required, true);
  assertEquals(blueprints.post.fields.author.type, "text");
  assertEquals(blueprints.post.fields.author.required, false);
});

Deno.test("loadBlueprints: parses extends field", async () => {
  const yaml = "title: Post\nextends: default\nfields:\n  date:\n    type: date\n    label: Date\n";
  const storage = makeStorage({ "blueprints/post.yaml": yaml });
  const blueprints = await loadBlueprints(storage, "blueprints");
  assertEquals(blueprints.post.extends, "default");
});

Deno.test("loadBlueprints: parses select options", async () => {
  const yaml = `
title: Article
fields:
  status:
    type: select
    label: Status
    options:
      draft: Draft
      published: Published
`;
  const storage = makeStorage({ "blueprints/article.yaml": yaml });
  const blueprints = await loadBlueprints(storage, "blueprints");
  assertEquals(blueprints.article.fields.status.options?.draft, "Draft");
  assertEquals(blueprints.article.fields.status.options?.published, "Published");
});

Deno.test("loadBlueprints: parses validate block", async () => {
  const yaml = `
title: Post
fields:
  rating:
    type: number
    label: Rating
    validate:
      min: 1
      max: 5
`;
  const storage = makeStorage({ "blueprints/post.yaml": yaml });
  const blueprints = await loadBlueprints(storage, "blueprints");
  assertEquals(blueprints.post.fields.rating.validate?.min, 1);
  assertEquals(blueprints.post.fields.rating.validate?.max, 5);
});

Deno.test("loadBlueprints: ignores non-.yaml files", async () => {
  const storage = makeStorage({
    "blueprints/post.yaml": "title: Post\nfields:\n  d:\n    type: date\n    label: D\n",
    "blueprints/readme.md": "# blueprints",
    "blueprints/notes.txt": "some notes",
  });
  const blueprints = await loadBlueprints(storage, "blueprints");
  assertEquals(Object.keys(blueprints), ["post"]);
});

Deno.test("loadBlueprints: skips and warns on malformed YAML (no crash)", async () => {
  const storage = makeStorage({
    "blueprints/good.yaml": "title: Good\nfields:\n  x:\n    type: text\n    label: X\n",
    "blueprints/bad.yaml": ": : invalid ::::\n",
  });
  const blueprints = await loadBlueprints(storage, "blueprints");
  // good should be loaded, bad should be skipped
  assertEquals("good" in blueprints, true);
  assertEquals("bad" in blueprints, false);
});

Deno.test("loadBlueprints: falls back to filename as title when YAML has no title", async () => {
  const storage = makeStorage({
    "blueprints/landing.yaml": "fields:\n  h1:\n    type: text\n    label: Heading\n",
  });
  const blueprints = await loadBlueprints(storage, "blueprints");
  assertEquals(blueprints.landing.title, "landing");
});

Deno.test("loadBlueprints: skips field with unknown type (warn, no crash)", async () => {
  const storage = makeStorage({
    "blueprints/p.yaml": `
title: P
fields:
  good:
    type: text
    label: Good
  bad:
    type: unknown_type
    label: Bad
`,
  });
  const blueprints = await loadBlueprints(storage, "blueprints");
  // "good" should be loaded, "bad" skipped
  assertEquals("good" in blueprints.p.fields, true);
  assertEquals("bad" in blueprints.p.fields, false);
});
