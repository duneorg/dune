/**
 * Code generator — produces TypeScript types and db/index.ts from DbSchema[].
 */

/** @module */

import { join } from "@std/path";
import type { ApiMethod, DbFieldDef, DbFieldType, DbSchema } from "./types.ts";

// ---------------------------------------------------------------------------
// Safety guard (defense-in-depth)
// ---------------------------------------------------------------------------

/**
 * Model and table names are interpolated into generated TypeScript source and
 * output filesystem paths.  The parser (parseRawSchema) already enforces this
 * regex, but we re-check here as defense-in-depth so that any code path that
 * builds a DbSchema object manually cannot bypass the constraint.
 */
const MODEL_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

function assertSafeIdentifier(name: string, label: string): void {
  if (!MODEL_NAME_RE.test(name)) {
    throw new Error(
      `[dune/codegen] ${label} must match /^[A-Za-z][A-Za-z0-9_]*$/ (got "${name}")`,
    );
  }
}

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
// API route generation
// ---------------------------------------------------------------------------

/**
 * Emit an inline validation block for required / maxLength / enum constraints.
 * Returns the generated lines (without surrounding blank lines).
 */
function emitValidationBlock(schema: DbSchema, bodyVar: string): string[] {
  const lines: string[] = [];
  const checks: string[] = [];

  for (const field of schema.fields) {
    if (field.required) {
      checks.push(
        `    if (${bodyVar}.${field.name} === undefined || ${bodyVar}.${field.name} === null || ${bodyVar}.${field.name} === "") {`,
        `      errors.push({ field: "${field.name}", message: "is required" });`,
        `    }`,
      );
    }
    if (field.maxLength !== undefined) {
      checks.push(
        `    if (typeof ${bodyVar}.${field.name} === "string" && ${bodyVar}.${field.name}.length > ${field.maxLength}) {`,
        `      errors.push({ field: "${field.name}", message: "exceeds maximum length of ${field.maxLength}" });`,
        `    }`,
      );
    }
    if (field.enum && field.enum.length > 0) {
      const allowed = JSON.stringify(field.enum);
      checks.push(
        `    if (${bodyVar}.${field.name} !== undefined && !${allowed}.includes(${bodyVar}.${field.name} as string)) {`,
        `      errors.push({ field: "${field.name}", message: "must be one of: ${field.enum.join(", ")}" });`,
        `    }`,
      );
    }
  }

  if (checks.length === 0) return [];

  lines.push(`  const errors: Array<{ field: string; message: string }> = [];`);
  lines.push(...checks);
  lines.push(`  if (errors.length > 0) return Response.json({ errors }, { status: 400 });`);
  return lines;
}

/**
 * Generate the `src/routes/api/{tableName}/index.ts` file (list + create).
 * Respects the methods listed in schema.api.methods.
 */
function generateApiIndexFile(schema: DbSchema): string {
  const api = schema.api!;
  const modelLower = camelCase(schema.model);
  const authMode = `"${api.auth}"`;
  const isOwner = api.auth === "owner";
  const ownerField = api.ownerField ?? "userId";
  const methods = new Set<ApiMethod>(api.methods);
  const lines: string[] = [
    "// GENERATED — do not edit. Run `dune codegen` to regenerate.",
    "",
    `import { db } from "@/db";`,
    `import type { ${schema.model}Create } from "@/db/types/${modelLower}.ts";`,
    `import { requireAuth } from "jsr:@dune/core/auth/api-guard";`,
    "",
  ];

  if (methods.has("list")) {
    lines.push(`export async function GET(req: Request): Promise<Response> {`);
    lines.push(`  const authResult = await requireAuth(req, ${authMode});`);
    lines.push(`  if (authResult.error) return authResult.error;`);
    lines.push(``);
    lines.push(`  const url = new URL(req.url);`);
    lines.push(`  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);`);
    lines.push(`  const offset = parseInt(url.searchParams.get("offset") ?? "0");`);
    if (isOwner) {
      lines.push(`  // Owner scoping: only list rows owned by the authenticated user.`);
      lines.push(`  const where = { ${ownerField}: authResult.user!.id } as any;`);
      lines.push(`  const records = await db.${schema.table}.find({ where, limit, offset });`);
      lines.push(`  const total = await db.${schema.table}.count({ where });`);
    } else {
      lines.push(`  const records = await db.${schema.table}.find({ limit, offset });`);
      lines.push(`  const total = await db.${schema.table}.count();`);
    }
    lines.push(`  return Response.json({ data: records, total, limit, offset });`);
    lines.push(`}`);
    lines.push("");
  }

  if (methods.has("create")) {
    lines.push(`export async function POST(req: Request): Promise<Response> {`);
    lines.push(`  const authResult = await requireAuth(req, ${authMode});`);
    lines.push(`  if (authResult.error) return authResult.error;`);
    lines.push(``);
    lines.push(`  const body = await req.json().catch(() => null);`);
    lines.push(`  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });`);
    lines.push(``);
    const validationLines = emitValidationBlock(schema, "body");
    for (const vl of validationLines) lines.push(vl);
    if (validationLines.length > 0) lines.push(``);
    if (isOwner) {
      lines.push(`  // Owner scoping: force ownership to the authenticated user; a`);
      lines.push(`  // client-supplied ${ownerField} must never win.`);
      lines.push(`  const record = await db.${schema.table}.create({ ...body, ${ownerField}: authResult.user!.id } as ${schema.model}Create);`);
    } else {
      lines.push(`  const record = await db.${schema.table}.create(body as ${schema.model}Create);`);
    }
    lines.push(`  return Response.json(record, { status: 201 });`);
    lines.push(`}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate the `src/routes/api/{tableName}/[id].ts` file (get, update, delete).
 * Respects the methods listed in schema.api.methods and ownership checks.
 */
function generateApiIdFile(schema: DbSchema): string {
  const api = schema.api!;
  const authMode = `"${api.auth}"`;
  const isOwner = api.auth === "owner";
  const ownerField = api.ownerField ?? "userId";
  const methods = new Set<ApiMethod>(api.methods);
  const lines: string[] = [
    "// GENERATED — do not edit. Run `dune codegen` to regenerate.",
    "",
    `import { db } from "@/db";`,
    `import type { ${schema.model}Update } from "@/db/types/${camelCase(schema.model)}.ts";`,
    `import { requireAuth } from "jsr:@dune/core/auth/api-guard";`,
    "",
  ];

  if (methods.has("get")) {
    lines.push(`export async function GET(req: Request, params: { id: string }): Promise<Response> {`);
    lines.push(`  const authResult = await requireAuth(req, ${authMode});`);
    lines.push(`  if (authResult.error) return authResult.error;`);
    lines.push(``);
    lines.push(`  const record = await db.${schema.table}.findOne({ where: { id: params.id } as any });`);
    lines.push(`  if (!record) return Response.json({ error: "Not found" }, { status: 404 });`);
    if (isOwner) {
      lines.push(`  if ((record as any).${ownerField} !== authResult.user!.id) {`);
      lines.push(`    return Response.json({ error: "Forbidden" }, { status: 403 });`);
      lines.push(`  }`);
    }
    lines.push(`  return Response.json(record);`);
    lines.push(`}`);
    lines.push("");
  }

  if (methods.has("update")) {
    lines.push(`export async function PUT(req: Request, params: { id: string }): Promise<Response> {`);
    lines.push(`  const authResult = await requireAuth(req, ${authMode});`);
    lines.push(`  if (authResult.error) return authResult.error;`);
    lines.push(``);
    if (isOwner) {
      lines.push(`  const existing = await db.${schema.table}.findOne({ where: { id: params.id } as any });`);
      lines.push(`  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });`);
      lines.push(`  if ((existing as any).${ownerField} !== authResult.user!.id) {`);
      lines.push(`    return Response.json({ error: "Forbidden" }, { status: 403 });`);
      lines.push(`  }`);
      lines.push(``);
    }
    lines.push(`  const body = await req.json().catch(() => null);`);
    lines.push(`  if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });`);
    lines.push(``);
    const validationLines = emitValidationBlock(schema, "body");
    for (const vl of validationLines) lines.push(vl);
    if (validationLines.length > 0) lines.push(``);
    if (isOwner) {
      lines.push(`  // Owner scoping: never let an update reassign ownership.`);
      lines.push(`  delete (body as Record<string, unknown>).${ownerField};`);
    }
    lines.push(`  const result = await db.${schema.table}.update(params.id, body as ${schema.model}Update);`);
    lines.push(`  if (result.count === 0) return Response.json({ error: "Not found" }, { status: 404 });`);
    lines.push(`  const record = await db.${schema.table}.findOne({ where: { id: params.id } as any });`);
    lines.push(`  return Response.json(record);`);
    lines.push(`}`);
    lines.push("");
  }

  if (methods.has("delete")) {
    lines.push(`export async function DELETE(req: Request, params: { id: string }): Promise<Response> {`);
    lines.push(`  const authResult = await requireAuth(req, ${authMode});`);
    lines.push(`  if (authResult.error) return authResult.error;`);
    lines.push(``);
    if (isOwner) {
      lines.push(`  const existing = await db.${schema.table}.findOne({ where: { id: params.id } as any });`);
      lines.push(`  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });`);
      lines.push(`  if ((existing as any).${ownerField} !== authResult.user!.id) {`);
      lines.push(`    return Response.json({ error: "Forbidden" }, { status: 403 });`);
      lines.push(`  }`);
      lines.push(``);
    }
    lines.push(`  const result = await db.${schema.table}.delete(params.id);`);
    lines.push(`  if (result.count === 0) return Response.json({ error: "Not found" }, { status: 404 });`);
    lines.push(`  return new Response(null, { status: 204 });`);
    lines.push(`}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate REST API route files for all schemas that have `api.enabled: true`.
 * Writes into `{siteRoot}/src/routes/api/{tableName}/`.
 *
 * Files are overwritten on each codegen run — they are generated, not user-edited.
 */
export async function generateApiRoutes(
  schemas: DbSchema[],
  siteRoot: string,
): Promise<string[]> {
  const written: string[] = [];

  for (const schema of schemas) {
    if (!schema.api?.enabled) continue;

    const apiDir = join(siteRoot, "src", "routes", "api", schema.table);
    await Deno.mkdir(apiDir, { recursive: true });

    const methods = new Set<ApiMethod>(schema.api.methods);

    if (methods.has("list") || methods.has("create")) {
      const indexPath = join(apiDir, "index.ts");
      await Deno.writeTextFile(indexPath, generateApiIndexFile(schema));
      written.push(indexPath);
    }

    if (methods.has("get") || methods.has("update") || methods.has("delete")) {
      const idPath = join(apiDir, "[id].ts");
      await Deno.writeTextFile(idPath, generateApiIdFile(schema));
      written.push(idPath);
    }
  }

  return written;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Output of {@link generateCode} — a map of relative file paths to generated TypeScript source. */
export interface CodegenResult {
  /** Map of relative file path → file content */
  files: Map<string, string>;
}

/**
 * Generate TypeScript source files for the given schemas.
 * Returns a map of relative paths → file contents (does not write to disk).
 *
 * Defense-in-depth: validates model/table names before any interpolation into
 * generated source or filesystem paths, even if the parser already checked them.
 */
export function generateCode(schemas: DbSchema[]): CodegenResult {
  const files = new Map<string, string>();

  for (const schema of schemas) {
    // Defense-in-depth: model and table names are interpolated into generated
    // TypeScript source and output file paths — assert they are safe identifiers.
    assertSafeIdentifier(schema.model, `model "${schema.model}"`);
    assertSafeIdentifier(schema.table, `table "${schema.table}"`);

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
 * Also writes API route files for schemas with `api.enabled: true`.
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

  // Generate API routes for schemas that have api.enabled: true
  const apiWritten = await generateApiRoutes(schemas, root);
  written.push(...apiWritten);

  return written;
}
