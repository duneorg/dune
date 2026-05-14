import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { KVAdapter } from "../../src/db/adapters/kv.ts";
import { createRepository } from "../../src/db/repository.ts";
import { parseSchemaYaml } from "../../src/db/schema-parser.ts";
import type { WhereClause } from "../../src/db/types.ts";

// ---------------------------------------------------------------------------
// Test model
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
    index: true
  author:
    type: string
    required: true
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

async function makeKvRepo() {
  const kv = await Deno.openKv(":memory:");
  const adapter = new KVAdapter(kv);
  const schema = parseSchemaYaml(COMMENT_SCHEMA_YAML);
  const repo = createRepository<Comment, CommentCreate, CommentUpdate>(
    schema.table,
    adapter,
    schema.fields,
  );
  const cleanup = () => kv.close();
  return { adapter, repo, schema, cleanup };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("kv: create and find all", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    const c = await repo.create({
      pageRoute: "/home",
      author: "Alice",
      body: "Hello",
      status: "pending",
    });

    assertEquals(typeof c.id, "string");
    assertEquals(c.pageRoute, "/home");
    assertEquals(c.createdAt instanceof Date, true);
    assertEquals(c.updatedAt instanceof Date, true);

    const all = await repo.find();
    assertEquals(all.length, 1);
    assertEquals(all[0].id, c.id);
  } finally {
    cleanup();
  }
});

Deno.test("kv: find with where clause (full scan)", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    await repo.create({ pageRoute: "/a", author: "Alice", body: "x", status: "approved" });
    await repo.create({ pageRoute: "/b", author: "Bob", body: "y", status: "pending" });
    await repo.create({ pageRoute: "/a", author: "Carol", body: "z", status: "approved" });

    const onA = await repo.find({ where: { pageRoute: "/a" } });
    assertEquals(onA.length, 2);

    const pending = await repo.find({ where: { status: "pending" } });
    assertEquals(pending.length, 1);
    assertEquals(pending[0].author, "Bob");
  } finally {
    cleanup();
  }
});

Deno.test("kv: findOne returns null when not found", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    const result = await repo.findOne({ where: { author: "Nobody" } });
    assertEquals(result, null);
  } finally {
    cleanup();
  }
});

Deno.test("kv: findOne throws when multiple rows match", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    await repo.create({ pageRoute: "/x", author: "Alice", body: "A", status: "pending" });
    await repo.create({ pageRoute: "/x", author: "Bob", body: "B", status: "pending" });

    await assertRejects(
      () => repo.findOne({ where: { pageRoute: "/x" } }),
      Error,
      "matched",
    );
  } finally {
    cleanup();
  }
});

Deno.test("kv: update modifies the record", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    const c = await repo.create({
      pageRoute: "/home",
      author: "Alice",
      body: "Old",
      status: "pending",
    });

    const { count } = await repo.update(c.id, { status: "approved" });
    assertEquals(count, 1);

    const all = await repo.find();
    assertEquals(all[0].status, "approved");
  } finally {
    cleanup();
  }
});

Deno.test("kv: update non-existent id returns count 0", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    const { count } = await repo.update("no-such-id", { status: "approved" });
    assertEquals(count, 0);
  } finally {
    cleanup();
  }
});

Deno.test("kv: delete removes the record", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    const c = await repo.create({
      pageRoute: "/home",
      author: "Alice",
      body: "Hi",
      status: "pending",
    });

    const { count } = await repo.delete(c.id);
    assertEquals(count, 1);

    const all = await repo.find();
    assertEquals(all.length, 0);
  } finally {
    cleanup();
  }
});

Deno.test("kv: delete non-existent id returns count 0", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    const { count } = await repo.delete("no-such-id");
    assertEquals(count, 0);
  } finally {
    cleanup();
  }
});

Deno.test("kv: count returns correct number", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    assertEquals(await repo.count(), 0);
    await repo.create({ pageRoute: "/a", author: "A", body: "x", status: "pending" });
    await repo.create({ pageRoute: "/b", author: "B", body: "y", status: "approved" });
    assertEquals(await repo.count(), 2);
    assertEquals(await repo.count({ where: { status: "approved" } }), 1);
  } finally {
    cleanup();
  }
});

Deno.test("kv: upsert inserts when no match", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    const result = await repo.upsert(
      { pageRoute: "/unique", author: "Alice" } as WhereClause<Comment>,
      { pageRoute: "/unique", author: "Alice", body: "New", status: "pending" },
    );
    assertEquals(result.body, "New");
    assertEquals(await repo.count(), 1);
  } finally {
    cleanup();
  }
});

Deno.test("kv: upsert updates when match found", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    await repo.create({ pageRoute: "/page", author: "Alice", body: "Old", status: "pending" });

    const result = await repo.upsert(
      { pageRoute: "/page", author: "Alice" } as WhereClause<Comment>,
      { pageRoute: "/page", author: "Alice", body: "Updated", status: "approved" },
    );

    assertEquals(result.body, "Updated");
    assertEquals(result.status, "approved");
    assertEquals(await repo.count(), 1);
  } finally {
    cleanup();
  }
});

Deno.test("kv: $in and $notIn operators", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    await repo.create({ pageRoute: "/a", author: "A", body: "x", status: "pending" });
    await repo.create({ pageRoute: "/b", author: "B", body: "y", status: "approved" });
    await repo.create({ pageRoute: "/c", author: "C", body: "z", status: "rejected" });

    const inResult = await repo.find({ where: { status: { $in: ["pending", "approved"] } } });
    assertEquals(inResult.length, 2);

    const notInResult = await repo.find({ where: { status: { $notIn: ["rejected"] } } });
    assertEquals(notInResult.length, 2);
  } finally {
    cleanup();
  }
});

Deno.test("kv: $contains and $startsWith operators", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
    await repo.create({ pageRoute: "/posts/hello", author: "A", body: "x", status: "pending" });
    await repo.create({ pageRoute: "/pages/about", author: "B", body: "y", status: "pending" });

    const contains = await repo.find({ where: { pageRoute: { $contains: "/posts" } } });
    assertEquals(contains.length, 1);

    const starts = await repo.find({ where: { pageRoute: { $startsWith: "/posts" } } });
    assertEquals(starts.length, 1);
  } finally {
    cleanup();
  }
});

Deno.test("kv: $or clause", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
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
    cleanup();
  }
});

Deno.test("kv: find with limit and offset", async () => {
  const { repo, cleanup } = await makeKvRepo();
  try {
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
    cleanup();
  }
});
