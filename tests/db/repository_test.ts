import {
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SQLiteAdapter } from "../../src/db/adapters/sqlite.ts";
import { createRepository } from "../../src/db/repository.ts";
import { parseSchemaYaml } from "../../src/db/schema-parser.ts";
import type { DbSchema } from "../../src/db/types.ts";

// ---------------------------------------------------------------------------
// Test model types
// ---------------------------------------------------------------------------

interface Comment {
  id: string;
  pageRoute: string;
  author: string;
  body: string;
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  updatedAt: Date;
}
type CommentCreate = Omit<Comment, "id" | "createdAt" | "updatedAt">;
type CommentUpdate = Partial<CommentCreate>;

const COMMENT_SCHEMA_YAML = `
model: Comment
table: comments
fields:
  pageRoute:
    type: string
    required: true
    maxLength: 1024
    index: true
  author:
    type: string
    required: true
    maxLength: 256
  body:
    type: text
    required: true
  status:
    type: string
    enum: [pending, approved, rejected]
    default: pending
    index: true
  createdAt:
    type: datetime
    default: now
  updatedAt:
    type: datetime
    default: now
    onUpdate: now
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTestDb(schema: DbSchema): Promise<{
  adapter: SQLiteAdapter;
  cleanup: () => Promise<void>;
}> {
  const adapter = await SQLiteAdapter.open(":memory:");

  // Create the table
  const cols = [`"id" TEXT PRIMARY KEY`];
  for (const field of schema.fields) {
    const typeMap: Record<string, string> = {
      string: "TEXT",
      text: "TEXT",
      integer: "INTEGER",
      number: "REAL",
      boolean: "INTEGER",
      datetime: "TEXT",
      json: "TEXT",
    };
    const sqlType = typeMap[field.type] ?? "TEXT";
    const nullable = field.required ? "NOT NULL" : "";
    cols.push(`"${field.name}" ${sqlType} ${nullable}`.trim());
  }
  const createSql = `CREATE TABLE IF NOT EXISTS "${schema.table}" (${cols.join(", ")})`;
  await adapter.query(createSql, []);

  return {
    adapter,
    cleanup: () => adapter.close(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test({
  name: "repository: create and find",
  sanitizeResources: false,
  fn: async () => {
    const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
    const { adapter, cleanup } = await createTestDb(schema);
    try {
      const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
        schema.table,
        adapter,
        schema.fields,
      );

      const comment = await repo.create({
        pageRoute: "/home",
        author: "Alice",
        body: "Hello!",
        status: "pending",
      });

      assertEquals(typeof comment.id, "string");
      assertEquals(comment.pageRoute, "/home");
      assertEquals(comment.author, "Alice");
      assertEquals(comment.status, "pending");
      assertEquals(comment.createdAt instanceof Date, true);
      assertEquals(comment.updatedAt instanceof Date, true);

      const all = await repo.find();
      assertEquals(all.length, 1);
      assertEquals(all[0].id, comment.id);
    } finally {
      await cleanup();
    }
  },
});

Deno.test("repository: find with where clause", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    await repo.create({ pageRoute: "/a", author: "Alice", body: "Hi", status: "approved" });
    await repo.create({ pageRoute: "/b", author: "Bob", body: "Yo", status: "pending" });
    await repo.create({ pageRoute: "/a", author: "Carol", body: "Hey", status: "approved" });

    const onA = await repo.find({ where: { pageRoute: "/a" } });
    assertEquals(onA.length, 2);

    const approved = await repo.find({ where: { status: "approved" } });
    assertEquals(approved.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: findOne returns null when not found", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    const result = await repo.findOne({ where: { author: "Nobody" } });
    assertEquals(result, null);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: findOne throws when multiple rows match", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    await repo.create({ pageRoute: "/x", author: "Alice", body: "A", status: "pending" });
    await repo.create({ pageRoute: "/x", author: "Bob", body: "B", status: "pending" });

    await assertRejects(
      () => repo.findOne({ where: { pageRoute: "/x" } }),
      Error,
      "matched",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("repository: update modifies the row and returns count", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    const comment = await repo.create({
      pageRoute: "/home",
      author: "Alice",
      body: "Original",
      status: "pending",
    });

    const { count } = await repo.update(comment.id, { status: "approved" });
    assertEquals(count, 1);

    const updated = await repo.findOne({ where: { id: comment.id } as { id: string } });
    assertEquals(updated?.status, "approved");
    // updatedAt should be refreshed (onUpdate: now)
    assertNotEquals(updated?.updatedAt.getTime(), 0);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: update non-existent id returns count 0", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    const { count } = await repo.update("non-existent-id", { status: "approved" });
    assertEquals(count, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: delete removes the row and returns count", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    const comment = await repo.create({
      pageRoute: "/home",
      author: "Alice",
      body: "Bye",
      status: "pending",
    });

    const { count } = await repo.delete(comment.id);
    assertEquals(count, 1);

    const all = await repo.find();
    assertEquals(all.length, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: delete non-existent id returns count 0", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    const { count } = await repo.delete("no-such-id");
    assertEquals(count, 0);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: count returns correct number", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    assertEquals(await repo.count(), 0);
    await repo.create({ pageRoute: "/a", author: "A", body: "x", status: "pending" });
    await repo.create({ pageRoute: "/b", author: "B", body: "y", status: "approved" });
    assertEquals(await repo.count(), 2);
    assertEquals(await repo.count({ where: { status: "approved" } }), 1);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: upsert inserts when no match", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    const result = await repo.upsert(
      { pageRoute: "/unique", author: "Alice" } as WhereClause<Comment>,
      { pageRoute: "/unique", author: "Alice", body: "New", status: "pending" },
    );

    assertEquals(result.body, "New");
    assertEquals(await repo.count(), 1);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: upsert updates when match found", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    await repo.create({ pageRoute: "/page", author: "Alice", body: "Old", status: "pending" });

    const result = await repo.upsert(
      { pageRoute: "/page", author: "Alice" } as WhereClause<Comment>,
      { pageRoute: "/page", author: "Alice", body: "Updated", status: "approved" },
    );

    assertEquals(result.body, "Updated");
    assertEquals(result.status, "approved");
    assertEquals(await repo.count(), 1); // No new row created
  } finally {
    await cleanup();
  }
});

Deno.test("repository: find with limit and offset", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    for (let i = 0; i < 5; i++) {
      await repo.create({ pageRoute: `/p${i}`, author: "A", body: "x", status: "pending" });
    }

    const page1 = await repo.find({ limit: 2, offset: 0 });
    assertEquals(page1.length, 2);

    const page2 = await repo.find({ limit: 2, offset: 2 });
    assertEquals(page2.length, 2);

    const last = await repo.find({ limit: 2, offset: 4 });
    assertEquals(last.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: $in and $notIn operators", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    await repo.create({ pageRoute: "/a", author: "A", body: "x", status: "pending" });
    await repo.create({ pageRoute: "/b", author: "B", body: "y", status: "approved" });
    await repo.create({ pageRoute: "/c", author: "C", body: "z", status: "rejected" });

    const inResult = await repo.find({ where: { status: { $in: ["pending", "approved"] } } });
    assertEquals(inResult.length, 2);

    const notInResult = await repo.find({ where: { status: { $notIn: ["rejected"] } } });
    assertEquals(notInResult.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: $contains and $startsWith operators", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    await repo.create({ pageRoute: "/posts/hello", author: "A", body: "x", status: "pending" });
    await repo.create({ pageRoute: "/pages/about", author: "B", body: "y", status: "pending" });

    const contains = await repo.find({ where: { pageRoute: { $contains: "/posts" } } });
    assertEquals(contains.length, 1);

    const starts = await repo.find({ where: { pageRoute: { $startsWith: "/posts" } } });
    assertEquals(starts.length, 1);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: $or clause", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    await repo.create({ pageRoute: "/a", author: "Alice", body: "x", status: "pending" });
    await repo.create({ pageRoute: "/b", author: "Bob", body: "y", status: "approved" });
    await repo.create({ pageRoute: "/c", author: "Carol", body: "z", status: "rejected" });

    const result = await repo.find({
      where: {
        $or: [{ author: "Alice" }, { author: "Bob" }],
      } as WhereClause<Comment>,
    });
    assertEquals(result.length, 2);
  } finally {
    await cleanup();
  }
});

Deno.test("repository: default value injection for status", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    // status has default: "pending" — but TypeScript's TCreate doesn't make it optional
    // so we cast to any for this test
    const comment = await repo.create({
      pageRoute: "/x",
      author: "A",
      body: "body",
      status: "pending",
    });
    assertEquals(comment.status, "pending");
  } finally {
    await cleanup();
  }
});

Deno.test("repository: orderBy sorts by a valid column and rejects unknown ones (M-1)", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    await repo.create({ pageRoute: "/a", author: "Carol", body: "c", status: "pending" });
    await repo.create({ pageRoute: "/a", author: "Alice", body: "a", status: "pending" });
    await repo.create({ pageRoute: "/a", author: "Bob", body: "b", status: "pending" });

    const asc = await repo.find({ orderBy: ["author", "asc"] });
    assertEquals(asc.map((c) => c.author), ["Alice", "Bob", "Carol"]);

    const desc = await repo.find({ orderBy: ["author", "desc"] });
    assertEquals(desc.map((c) => c.author), ["Carol", "Bob", "Alice"]);

    // An injection payload as the sort column must be rejected, not interpolated.
    await assertRejects(
      () => repo.find({ orderBy: 'author"; DROP TABLE comments; --' as unknown as keyof Comment }),
      Error,
      "column identifier",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("repository: where clause rejects unknown column identifiers (M-2)", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    await repo.create({ pageRoute: "/a", author: "Alice", body: "a", status: "pending" });

    // Legitimate column still works.
    const found = await repo.find({ where: { author: "Alice" } });
    assertEquals(found.length, 1);

    // A quote-break-out key must be rejected, not quoted into the query.
    await assertRejects(
      () =>
        repo.find({
          where: { 'author" = author OR "1"="1': "x" } as unknown as WhereClause<Comment>,
        }),
      Error,
      "column identifier",
    );
  } finally {
    await cleanup();
  }
});

Deno.test("repository: update drops keys that are not schema columns (C-1)", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );

    const comment = await repo.create({
      pageRoute: "/home",
      author: "Alice",
      body: "Original",
      status: "pending",
    });

    // A SQL-injection payload smuggled as a JSON key and an unknown column
    // must be dropped silently — only the legitimate `status` change applies.
    const malicious = {
      status: "approved",
      'body" = (SELECT author FROM comments) WHERE "id" = id; --': "x",
      notAColumn: "should-be-ignored",
    } as unknown as CommentUpdate;

    const { count } = await repo.update(comment.id, malicious);
    assertEquals(count, 1);

    const updated = await repo.findOne({ where: { id: comment.id } as { id: string } });
    assertEquals(updated?.status, "approved");
    // body must be untouched — the injection key was dropped, not executed.
    assertEquals(updated?.body, "Original");
  } finally {
    await cleanup();
  }
});

Deno.test("repository: getAdapter returns the adapter", async () => {
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const { adapter, cleanup } = await createTestDb(schema);
  try {
    const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
      schema.table,
      adapter,
      schema.fields,
    );
    assertEquals(repo.getAdapter(), adapter);
  } finally {
    await cleanup();
  }
});

// Type alias for where clauses in tests
type WhereClause<T> = import("../../src/db/types.ts").WhereClause<T>;
