import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseRawSchema, parseSchemaYaml, modelToTableName } from "../../src/db/schema-parser.ts";

// ---------------------------------------------------------------------------
// modelToTableName
// ---------------------------------------------------------------------------

Deno.test("modelToTableName: simple model", () => {
  assertEquals(modelToTableName("Comment"), "comments");
});

Deno.test("modelToTableName: already plural", () => {
  // Status already ends in 's' so no additional 's' is appended
  assertEquals(modelToTableName("Status"), "status");
});

Deno.test("modelToTableName: camel case", () => {
  assertEquals(modelToTableName("BlogPost"), "blog_posts");
});

Deno.test("modelToTableName: single word", () => {
  assertEquals(modelToTableName("User"), "users");
});

// ---------------------------------------------------------------------------
// parseRawSchema — valid inputs
// ---------------------------------------------------------------------------

Deno.test("parseRawSchema: parses a basic schema", () => {
  const raw = {
    model: "Comment",
    table: "comments",
    fields: {
      body: { type: "text", required: true },
      author: { type: "string", maxLength: 256 },
    },
  };
  const schema = parseRawSchema(raw);
  assertEquals(schema.model, "Comment");
  assertEquals(schema.table, "comments");
  assertEquals(schema.fields.length, 2);
  assertEquals(schema.fields[0].name, "body");
  assertEquals(schema.fields[0].type, "text");
  assertEquals(schema.fields[0].required, true);
  assertEquals(schema.fields[1].name, "author");
  assertEquals(schema.fields[1].maxLength, 256);
});

Deno.test("parseRawSchema: infers table from model name", () => {
  const schema = parseRawSchema({ model: "Product", fields: { name: { type: "string" } } });
  assertEquals(schema.table, "products");
});

Deno.test("parseRawSchema: all field types", () => {
  const types = ["string", "text", "integer", "number", "boolean", "datetime", "json"] as const;
  const fields: Record<string, { type: string }> = {};
  for (const t of types) {
    fields[`field_${t}`] = { type: t };
  }
  const schema = parseRawSchema({ model: "AllTypes", fields });
  assertEquals(schema.fields.length, types.length);
});

Deno.test("parseRawSchema: enum field", () => {
  const schema = parseRawSchema({
    model: "Post",
    fields: { status: { type: "string", enum: ["draft", "published"], default: "draft" } },
  });
  assertEquals(schema.fields[0].enum, ["draft", "published"]);
  assertEquals(schema.fields[0].default, "draft");
});

Deno.test("parseRawSchema: datetime with default:now and onUpdate:now", () => {
  const schema = parseRawSchema({
    model: "Post",
    fields: {
      createdAt: { type: "datetime", default: "now" },
      updatedAt: { type: "datetime", default: "now", onUpdate: "now" },
    },
  });
  assertEquals(schema.fields[0].default, "now");
  assertEquals(schema.fields[1].onUpdate, "now");
});

Deno.test("parseRawSchema: index field", () => {
  const schema = parseRawSchema({
    model: "Post",
    fields: { slug: { type: "string", index: true } },
  });
  assertEquals(schema.fields[0].index, true);
});

// ---------------------------------------------------------------------------
// parseRawSchema — invalid inputs
// ---------------------------------------------------------------------------

Deno.test("parseRawSchema: throws when model missing", () => {
  assertThrows(() => parseRawSchema({ fields: {} }), Error, "model");
});

Deno.test("parseRawSchema: throws when fields missing", () => {
  assertThrows(() => parseRawSchema({ model: "Foo" }), Error, "fields");
});

Deno.test("parseRawSchema: throws on invalid field type", () => {
  assertThrows(
    () => parseRawSchema({ model: "Foo", fields: { x: { type: "badtype" } } }),
    Error,
    "unsupported type",
  );
});

Deno.test("parseRawSchema: throws on invalid onUpdate", () => {
  assertThrows(
    () =>
      parseRawSchema({ model: "Foo", fields: { x: { type: "datetime", onUpdate: "today" } } }),
    Error,
    "onUpdate",
  );
});

Deno.test("parseRawSchema: throws when schema is not an object", () => {
  assertThrows(() => parseRawSchema("not-an-object"), Error);
  assertThrows(() => parseRawSchema(null), Error);
  assertThrows(() => parseRawSchema([]), Error);
});

// ---------------------------------------------------------------------------
// parseSchemaYaml
// ---------------------------------------------------------------------------

Deno.test("parseSchemaYaml: parses valid YAML", () => {
  const yaml = `
model: Comment
table: comments
fields:
  body:
    type: text
    required: true
  status:
    type: string
    enum:
      - pending
      - approved
    default: pending
`;
  const schema = parseSchemaYaml(yaml);
  assertEquals(schema.model, "Comment");
  assertEquals(schema.fields.length, 2);
  assertEquals(schema.fields[1].enum, ["pending", "approved"]);
});

Deno.test("parseSchemaYaml: throws on invalid YAML", () => {
  assertThrows(() => parseSchemaYaml("{ invalid yaml: ["), Error);
});

Deno.test("parseSchemaYaml: throws on valid YAML with missing model", () => {
  assertThrows(() => parseSchemaYaml("fields:\n  x:\n    type: string\n"), Error, "model");
});
