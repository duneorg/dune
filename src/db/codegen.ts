/**
 * Code generator — produces TypeScript types and db/index.ts from DbSchema[].
 */

/** @module */

import { join } from "@std/path";
import type { DbFieldDef, DbFieldType, DbSchema } from "./types.ts";

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function tsType(field: DbFieldDef): string {
  if (field.enum && field.enum.length > 0) {
    return field.enum.map((v) => `"${v}"`).join(" | ");
  }
  const base: Record<DbFieldType, string> = {
    string: "string",
    text: "string",
    integer: "number",
    number: "number",
    boolean: "boolean",
    datetime: "Date",
    json: "unknown",
  };
  return base[field.type] ?? "unknown";
}

/** Return the field names that are auto-managed and excluded from TCreate. */
function autoFields(fields: DbFieldDef[]): string[] {
  const auto: string[] = [];
  for (const f of fields) {
    if (f.type === "datetime" && (f.default === "now" || f.onUpdate === "now")) {
      auto.push(f.name);
    }
  }
  return auto;
}

// ---------------------------------------------------------------------------
// Per-model type file
// ---------------------------------------------------------------------------

function generateModelFile(schema: DbSchema): string {
  const lines: string[] = [
    "// GENERATED — do not edit. Run `dune codegen` to regenerate.",
    "",
  ];

  // Main interface
  lines.push(`export interface ${schema.model} {`);
  lines.push(`  id: string;`);
  for (const field of schema.fields) {
    const optional = !field.required && field.default === undefined && field.type !== "datetime"
      ? "?"
      : "";
    lines.push(`  ${field.name}${optional}: ${tsType(field)};`);
  }
  lines.push(`}`);
  lines.push("");

  // TCreate — Omit auto-managed fields
  const omitFields = ["id", ...autoFields(schema.fields)];
  const omitStr = omitFields.map((f) => `"${f}"`).join(" | ");
  lines.push(
    `export type ${schema.model}Create = Omit<${schema.model}, ${omitStr}>;`,
  );

  // TUpdate — Partial of TCreate
  lines.push(`export type ${schema.model}Update = Partial<${schema.model}Create>;`);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// db/index.ts
// ---------------------------------------------------------------------------

function camelCase(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function generateIndexFile(schemas: DbSchema[]): string {
  const lines: string[] = [
    "// GENERATED — do not edit. Run `dune codegen` to regenerate.",
    "",
    `import { createDbAdapter } from "@dune/core/db";`,
    `import { createRepository } from "@dune/core/db";`,
  ];

  for (const schema of schemas) {
    const modelLower = camelCase(schema.model);
    lines.push(
      `import type { ${schema.model}, ${schema.model}Create, ${schema.model}Update } from "./types/${modelLower}.ts";`,
    );
  }

  lines.push("");
  lines.push("const adapter = await createDbAdapter();");
  lines.push("");
  lines.push("export const db = {");

  for (const schema of schemas) {
    const propName = schema.table; // e.g. "comments"
    lines.push(
      `  ${propName}: createRepository<${schema.model}, ${schema.model}Create, ${schema.model}Update>("${schema.table}", adapter),`,
    );
  }

  lines.push("};");
  lines.push("");

  // Re-export types
  for (const schema of schemas) {
    lines.push(
      `export type { ${schema.model}, ${schema.model}Create, ${schema.model}Update };`,
    );
  }
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CodegenResult {
  /** Map of relative file path → file content */
  files: Map<string, string>;
}

/**
 * Generate TypeScript source files for the given schemas.
 * Returns a map of relative paths → file contents (does not write to disk).
 */
export function generateCode(schemas: DbSchema[]): CodegenResult {
  const files = new Map<string, string>();

  for (const schema of schemas) {
    const modelLower = camelCase(schema.model);
    files.set(`src/db/types/${modelLower}.ts`, generateModelFile(schema));
  }

  files.set("src/db/index.ts", generateIndexFile(schemas));

  return { files };
}

/**
 * Write generated files to `root` directory.
 *
 * Creates `src/db/types/` if it does not exist.
 */
export async function writeGeneratedFiles(
  root: string,
  schemas: DbSchema[],
): Promise<string[]> {
  const { files } = generateCode(schemas);
  const written: string[] = [];

  // Ensure types directory exists
  await Deno.mkdir(join(root, "src", "db", "types"), { recursive: true });

  for (const [relPath, content] of files) {
    const absPath = join(root, relPath);
    await Deno.writeTextFile(absPath, content);
    written.push(absPath);
  }

  return written;
}
