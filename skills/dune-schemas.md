# Skill: Dune Schema Layer

All data models — whether file-backed or database-backed — are defined in `schemas/` using a unified YAML format. The `store:` field determines the runtime interface and backend. **`store:` is required; omitting it is an error.**

```
schemas/
  posts.yaml       # store: local — YAML files, slug-as-id, local.* interface
  comments.yaml    # store: db    — SQLite/KV/Postgres, UUID id, db.* interface
```

`flex-objects/` is the legacy directory (backwards-compatible, not for new models).

---

## Schema format

```yaml
# schemas/comments.yaml
model: Comment
store: db
table: comments     # optional — defaults to snake_case plural of model name

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
    type: text        # no maxLength — textarea in admin UI
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
```

### Field types

| Type | Notes |
|------|-------|
| `string` | Short text, maxLength applies |
| `text` | Long text, no maxLength, textarea in admin UI |
| `integer` | Whole numbers |
| `number` | Floating point |
| `boolean` | true / false |
| `datetime` | ISO timestamp. `default: now`, `onUpdate: now` supported |
| `json` | Arbitrary JSON blob |

`id` is always auto-generated — never declare it in the schema. For `store: db` it is a UUID string. For `store: local` it is the content slug (filename stem).

### Field options

| Option | Applies to | Notes |
|--------|-----------|-------|
| `required` | all | Field must be present on create |
| `nullable` | all | Allows null values explicitly |
| `default` | all | Value used when field is omitted on create |
| `enum` | string | Restricts to listed values |
| `index` | string, integer, datetime | Adds DB index; improves query performance |
| `maxLength` | string | Enforced at the application layer |
| `onUpdate` | datetime | Auto-set on every update (`now` is the only value) |

---

## `store: local` — file-backed models

```yaml
model: Post
store: local
fields:
  title:
    type: string
    required: true
  body:
    type: text
  publishedAt:
    type: datetime
    nullable: true
```

Records live as YAML files in `content/<type>/`. The id is the filename stem (slug). Interface is `local.*`:

```ts
import { local } from "@/db";

const posts = await local.posts.find({ where: { publishedAt: { isNull: false } } });
const post  = await local.posts.findOne({ where: { id: "hello-world" } });
const draft = await local.posts.create({ data: { title: "Draft", body: "..." } });
await local.posts.update({ where: { id: "hello-world" }, data: { title: "Updated" } });
await local.posts.delete({ where: { id: "old-post" } });
```

Use `store: local` when:
- Content is git-tracked and human-editable
- IDs are meaningful slugs (not UUIDs)
- The dataset is small (hundreds of records)
- No transactions are needed

---

## `store: db` — database-backed models

```yaml
model: Comment
store: db
fields:
  pageRoute:
    type: string
    required: true
    index: true
  body:
    type: text
    required: true
  status:
    type: string
    enum: [pending, approved, rejected]
    default: pending
```

Records live in the configured DB backend. The id is a UUID string. Interface is `db.*`:

```ts
import { db } from "@/db";

const comments = await db.comments.find({
  where: { pageRoute: "/blog/hello", status: "approved" },
  orderBy: { field: "createdAt", dir: "desc" },
  limit: 20,
  offset: 0,
});

const comment = await db.comments.findOne({ where: { id } });
// throws if where matches more than one row

const created = await db.comments.create({
  data: { pageRoute, author, body },
});

await db.comments.update({
  where: { id },
  data: { status: "approved" },
});

await db.comments.delete({ where: { id } });

const { count } = await db.comments.delete({
  where: { pageRoute: "/blog/deleted-post" },
});

// upsert — use this instead of find-then-create to avoid race conditions
await db.subscribers.upsert({
  where: { email },
  create: { email, name },
  update: { name },
});
```

### `where` clause operators

```ts
// Equality (shorthand)
where: { status: "approved" }

// Comparison
where: { createdAt: { gt: new Date("2026-01-01") } }
where: { status: { in: ["pending", "approved"] } }
where: { email: { contains: "@example.com" } }
where: { deletedAt: { isNull: true } }

// Multiple fields — implicit AND
where: { status: "approved", pageRoute: "/blog/hello" }

// Explicit OR
where: { OR: [{ status: "pending" }, { status: "approved" }] }
```

Full operator list: `eq`, `ne`, `in`, `notIn`, `lt`, `lte`, `gt`, `gte`, `contains`, `startsWith`, `isNull`.

### `orderBy`

```ts
orderBy: "createdAt"                              // ascending
orderBy: { field: "createdAt", dir: "desc" }
orderBy: [{ field: "status" }, { field: "createdAt", dir: "desc" }]
```

### Escape hatches

```ts
import { getAdapter } from "@/db";
import type { SqliteAdapter } from "@dune/core";

// Transactions
await (getAdapter() as SqliteAdapter).transaction(async (tx) => {
  await tx.execute("INSERT INTO orders ...", [...]);
  await tx.execute("INSERT INTO audit_log ...", [...]);
});

// Aggregate queries
const rows = await getAdapter().query(
  "SELECT page_route, COUNT(*) as total FROM comments GROUP BY page_route ORDER BY total DESC LIMIT 10"
);
```

Use escape hatches for: transactions, GROUP BY / aggregate queries, field-to-field comparisons, joins. They are expected paths for these cases, not workarounds.

### DB backends

Auto-detected at runtime — no config needed for the common cases:

| Environment | Backend | Notes |
|------------|---------|-------|
| Deno Deploy | Deno KV | Detected via `DENO_DEPLOYMENT_ID`. Non-ID `where` clauses are full scans — document this for users |
| Self-hosted / Fly | SQLite | Path from `DUNE_DB_PATH` (default: `./data/app.db`) |
| Multi-machine | Postgres | `PostgresAdapter` via `npm:postgres`. Set `DUNE_DB_URL` |

---

## Codegen and migrations

After creating or modifying a schema file, run:

```sh
deno task codegen       # generates TypeScript types + src/db/index.ts + @/db alias
dune migrate:generate   # generates SQL migration files in data/migrations/
dune migrate            # applies pending migrations
```

`dune codegen` writes the `@/db` import alias to `deno.json`. Always import from `@/db`, never from a relative path — nested routes become `../../../../db/index.ts` without the alias.

---

## Admin UI

Admin list and edit views are generated from `schemas/*.yaml` regardless of `store`. The same pipeline that generates Flex Object admin views applies to `store: db` models. No extra config needed.

---

## CRUD API generation

Add an `api:` block to expose REST endpoints:

```yaml
# schemas/comments.yaml
model: Comment
store: db
api:
  enabled: true          # generates /api/comments endpoints
  auth: required         # all endpoints require auth; omit for public
  methods: [get, list]   # restrict to read-only; omit for full CRUD
```

Full CRUD generates: `GET /api/comments`, `GET /api/comments/:id`, `POST /api/comments`, `PUT /api/comments/:id`, `DELETE /api/comments/:id`.

---

## Migrating from Flex Objects to DB

```sh
dune migrate:from-flex <type>
```

Reads `flex-objects/<type>.yaml`, rewrites to `schemas/<type>.yaml` with `store: db`, generates a DB migration, imports existing records, and outputs the code diff (`local.<type>.*` → `db.<type>.*`). The interface change is explicit — callers must be updated.

---

## Gotchas

**`store:` is required.** Omitting it in `schemas/` is an error with a clear message. Files in `flex-objects/` default to `local` silently (backwards compat only).

**`store: local` id is a slug, not a UUID.** `local.posts.findOne({ where: { id: "hello-world" } })` — the id is the filename stem. Do not generate UUIDs for local store records.

**`store: db` on Deno Deploy uses KV.** Non-ID `where` clauses (anything other than `{ id }`) require a full scan. This is fine for small datasets; for larger ones, switch to Postgres.

**`findOne` throws when more than one row matches.** This is intentional — it surfaces schema design mistakes early. If you expect multiple rows, use `find` with `limit: 1`.

**`update` and `delete` return `{ count: number }`.** Check `count === 0` to detect a missing record.

**Use `upsert` instead of find-then-create.** A `find` followed by a conditional `create` is a TOCTOU race under concurrent requests. `upsert` handles this atomically.

**Always import from `@/db`, never relative paths.** If `@/db` isn't resolving, run `deno task codegen` — it writes the alias to `deno.json`.

**No relations in the query interface.** Do two queries. For cascade operations, use a plugin hook (`onPageDelete`) or the `getAdapter().transaction()` escape hatch.
