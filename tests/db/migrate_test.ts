/**
 * Tests for DDL generation safety (M-6): identifier quoting, literal escaping,
 * and quote-aware statement splitting.
 */

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { generateCreateTableSql, splitSqlStatements } from "../../src/db/migrate.ts";
import { parseSchemaYaml } from "../../src/db/schema-parser.ts";

Deno.test("generateCreateTableSql: quotes table name and index identifiers (M-6)", () => {
  const schema = parseSchemaYaml(`
model: Post
table: posts
fields:
  title:
    type: string
    index: true
`);
  const sql = generateCreateTableSql(schema);
  assertStringIncludes(sql, `CREATE TABLE IF NOT EXISTS "posts" (`);
  assertStringIncludes(sql, `ON "posts"("title")`);
  assertStringIncludes(sql, `"idx_posts_title"`);
});

Deno.test("generateCreateTableSql: escapes single quotes in defaults and enums (M-6)", () => {
  const schema = parseSchemaYaml(`
model: Item
table: items
fields:
  label:
    type: string
    default: "O'Brien"
  status:
    type: string
    enum: ["a'b", "c"]
    default: "c"
`);
  const sql = generateCreateTableSql(schema);
  // Embedded single quote is doubled, not left to break out of the literal.
  assertStringIncludes(sql, `DEFAULT 'O''Brien'`);
  assertStringIncludes(sql, `'a''b'`);
  assertStringIncludes(sql, `CHECK("status" IN (`);
});

Deno.test("splitSqlStatements: ignores semicolons inside quoted strings (M-6)", () => {
  const out = splitSqlStatements(
    `INSERT INTO t (a) VALUES ('x; y'); CREATE INDEX "i;dx" ON t(a);`,
  ).map((s) => s.trim()).filter((s) => s.length > 0);
  assertEquals(out.length, 2);
  assertStringIncludes(out[0], `'x; y'`);
  assertStringIncludes(out[1], `"i;dx"`);
});

Deno.test("splitSqlStatements: handles escaped quotes within literals (M-6)", () => {
  const out = splitSqlStatements(`SELECT 'O''Brien; Jr'; SELECT 2;`)
    .map((s) => s.trim()).filter((s) => s.length > 0);
  assertEquals(out.length, 2);
  assertStringIncludes(out[0], `'O''Brien; Jr'`);
});
