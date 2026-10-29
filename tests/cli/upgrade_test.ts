import { assertEquals } from "jsr:@std/assert@^1";
import { rewriteCoreRefs } from "../../src/cli/upgrade.ts";

// Shape of a real pre-entrypoint site (exact pins, versioned CLI in tasks).
const LEGACY = `{
  "tasks": {
    "dev": "deno run -A jsr:@dune/core@0.34.13/cli dev --env-file",
    "serve": "deno run -A jsr:@dune/core@0.34.13/cli serve --env-file"
  },
  "imports": {
    "@dune/core": "jsr:@dune/core@0.34.13",
    "@dune/core/ui/editable": "jsr:@dune/core@0.34.13/ui/editable",
    "@dune/plugin-pdf": "jsr:@dune/plugin-pdf@1.3.1"
  }
}
`;

Deno.test("rewriteCoreRefs: moves the import, its subpaths and the CLI specifier together", () => {
  const { updated, changes } = rewriteCoreRefs(LEGACY, "0.35.1");
  assertEquals(changes.length, 4);
  assertEquals(updated.includes("0.34.13"), false);
  assertEquals(updated.includes('"@dune/core": "jsr:@dune/core@0.35.1"'), true);
  assertEquals(updated.includes('"@dune/core/ui/editable": "jsr:@dune/core@0.35.1/ui/editable"'), true);
  assertEquals(updated.includes("jsr:@dune/core@0.35.1/cli serve --env-file"), true);
  // Other packages are untouched.
  assertEquals(updated.includes("jsr:@dune/plugin-pdf@1.3.1"), true);
  // Still valid JSON, formatting preserved.
  JSON.parse(updated);
  assertEquals(updated.replaceAll("0.35.1", "0.34.13"), LEGACY);
});

Deno.test("rewriteCoreRefs: keeps each reference's style (exact, caret, partial)", () => {
  const raw = `{"imports":{
    "a": "jsr:@dune/core@0.34.13",
    "b": "jsr:@dune/core@^0.34.13",
    "c": "jsr:@dune/core@^0.34",
    "d": "jsr:@dune/core@~0.34.1/security"
  }}`;
  const { updated } = rewriteCoreRefs(raw, "0.35.2");
  const imports = JSON.parse(updated).imports;
  assertEquals(imports.a, "jsr:@dune/core@0.35.2");
  assertEquals(imports.b, "jsr:@dune/core@^0.35.2");
  assertEquals(imports.c, "jsr:@dune/core@^0.35");
  assertEquals(imports.d, "jsr:@dune/core@~0.35.2/security");
});

Deno.test("rewriteCoreRefs: never rewrites JSON keys", () => {
  const raw = `{"imports":{"jsr:@dune/core@^0.34": "./dune/mod.ts", "x": "jsr:@dune/core@0.34.0"}}`;
  const { updated, changes } = rewriteCoreRefs(raw, "0.35.0");
  assertEquals(changes.length, 1);
  const imports = JSON.parse(updated).imports;
  assertEquals(imports["jsr:@dune/core@^0.34"], "./dune/mod.ts");
  assertEquals(imports.x, "jsr:@dune/core@0.35.0");
});

Deno.test("rewriteCoreRefs: leaves up-to-date and newer references alone unless forced", () => {
  const raw = `{"imports":{"a":"jsr:@dune/core@0.35.0","b":"jsr:@dune/core@0.36.0"}}`;
  const plain = rewriteCoreRefs(raw, "0.35.0");
  assertEquals(plain.changes.length, 0);
  assertEquals(plain.updated, raw);
  // An explicit version (rollback or exact choice) is applied everywhere.
  const forced = rewriteCoreRefs(raw, "0.35.0", true);
  assertEquals(forced.changes.length, 1);
  assertEquals(JSON.parse(forced.updated).imports.b, "jsr:@dune/core@0.35.0");
});

Deno.test("rewriteCoreRefs: no core reference means no changes", () => {
  const raw = `{"imports":{"@std/path":"jsr:@std/path@^1"}}`;
  assertEquals(rewriteCoreRefs(raw, "0.35.0").changes, []);
});
