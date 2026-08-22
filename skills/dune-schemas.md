# Skill: Dune Data Layer (`schemas/`)

`schemas/*.yaml` defines **database-backed application data** — SQLite, Deno KV, or PostgreSQL, auto-selected. **There is no `store:` field, and no file-backed mode within this system at all.** `schemas/` is exclusively for data your code creates and queries; there's no `store: local`/`store: db` split.

File-backed, CMS-editable custom content types (products, team members, events, FAQs — anything an editor manages through the admin UI) are a **separate, current, first-class system: Flex Objects** (`flex-objects/{type}.yaml` schema + `flex-objects/{type}/{id}.yaml` records). It is not "legacy" or deprecated — it has its own admin UI generation that `schemas/*.yaml` models never get (see "No admin UI" below). If you need editor-managed content, use Flex Objects, not this system.

```
schemas/
  comments.yaml    # DB-backed application data — SQLite/KV/Postgres
  subscribers.yaml

flex-objects/
  products.yaml           # Flex Object schema — editor-managed via admin UI
  products/apple.yaml      # a Flex Object record
```

---

## Schema format

```yaml
# schemas/comments.yaml
model: Comment
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
    type: text        # no maxLength — long text
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
    onUpdate: now
```

There is no `store:` field to set — omit it, don't add one.

### Field types

| Type | TypeScript | SQL |
|------|-----------|-----|
| `string` | `string` | `TEXT` — `maxLength` enforced at the application layer |
| `text` | `string` | `TEXT` — no length limit |
| `integer` | `number` | `INTEGER` |
| `number` | `number` | `REAL` |
| `boolean` | `boolean` | `INTEGER 0/1` |
| `datetime` | `Date` | `TEXT (ISO 8601)` — `default: now`, `onUpdate: now` |
| `json` | `unknown` | `TEXT (JSON string)` |

(`src/db/schema-parser.ts`'s `VALID_TYPES` — exactly these seven, nothing else.)

### Field options

| Option | Applies to | Notes |
|--------|-----------|-------|
| `required` | all | Field must be present on create. **There is no `nullable` option** — presence/optionality is governed by `required` alone; don't write `nullable: true`, it isn't a recognized field and is silently ignored by the parser. |
| `default` | all | Value used when field is omitted on create. `"now"` for `datetime` auto-timestamps. |
| `enum` | string | Restricts to listed values. |
| `index` | any | Adds a secondary index (SQLite/Postgres). |
| `maxLength` | string | Enforced at the application layer, not the DB. |
| `onUpdate` | datetime | Auto-set on every update — `"now"` is the only supported value. |

`id` is always auto-generated (`crypto.randomUUID()`) — never declare it in the schema.

---

## Codegen

```sh
dune codegen             # generates src/db/types/{model}.ts + src/db/index.ts
dune migrate:generate    # diffs schemas against existing migrations, emits SQL into data/migrations/
dune migrate:run         # applies pending migrations (NOT `dune migrate` — that's not a command)
dune migrate:status      # shows applied vs pending
```

`dune codegen` generates one file per model (`src/db/types/{model}.ts`, exporting `{Model}`, `{Model}Create`, `{Model}Update` interfaces) plus `src/db/index.ts`:

```ts
// src/db/index.ts — GENERATED, do not edit
import { createDbAdapter, createRepository } from "@dune/core/db";
import type { Comment, CommentCreate, CommentUpdate } from "./types/comment.ts";
// ... one import per model

const adapter = await createDbAdapter();

export const db = {
  comments: createRepository<Comment, CommentCreate, CommentUpdate>("comments", adapter),
  // ... one entry per model, keyed by table name (lowercase)
};

export type { Comment, CommentCreate, CommentUpdate /* ... */ };
```

**`dune codegen` does not write any import-map alias to `deno.json`.** `@/db` only resolves if the site's own `deno.json` already has a generic `@/` → `./src/` mapping (`dune new` does not set this up either) — check for it before assuming it works, or just import the relative path:

```ts
import { db } from "../../src/db/index.ts"; // or "@/db" if your project's deno.json maps it
```

Migrations live in `data/migrations/` (not bare `migrations/`), tracked by a `_dune_migrations` table in the database. Not auto-applied on startup — run `dune migrate:run` as part of deploy.

---

## Repository API

Every model gets a repository at `db.{table}` with this exact shape — **not** a Prisma-style `{where, data}`-wrapped API:

```ts
import { db } from "@/db"; // or the relative path — see above

// find — where/orderBy/limit/offset
const comments = await db.comments.find({
  where: { pageRoute: "/blog/hello", status: "approved" },
  orderBy: ["createdAt", "desc"],   // a tuple — [field, "asc"|"desc"] — or bare "createdAt" for ascending.
  limit: 20,                        // NOTE: no multi-field orderBy array exists — one field only.
  offset: 0,
});

const comment = await db.comments.findOne({ where: { id } });
// returns null when zero rows match; THROWS when more than one row matches
// ("where clause must match at most one row") — this is intentional, it
// surfaces schema/query design mistakes early rather than silently
// returning an arbitrary row

const created = await db.comments.create({ pageRoute, author, body }); // flat data, no {data: ...} wrapper

// update/delete take a positional id — NOT { where: { id }, data }
const { count } = await db.comments.update(comment.id, { status: "approved" });
const { count: deleted } = await db.comments.delete(comment.id); // single id only — no bulk where-based delete

// upsert — positional (where, data), not a { where, create, update } object
const sub = await db.subscribers.upsert({ email }, { email, name });

const total = await db.comments.count({ where: { status: "pending" } });
```

(`src/db/repository.ts`, `src/db/types.ts`.)

### `where` clause operators — all `$`-prefixed

```ts
where: { status: "approved" }                              // equality — bare value, no operator
where: { createdAt: { $gt: new Date("2026-01-01") } }
where: { status: { $in: ["pending", "approved"] } }
where: { status: { $notIn: ["rejected"] } }
where: { email: { $contains: "@example.com" } }
where: { email: { $startsWith: "alice" } }
where: { updatedAt: { $isNull: true } }
where: { $or: [{ status: "pending" }, { status: "approved" }] }
```

Full operator set (`FieldOperators<V>`): `$gt`, `$lt`, `$gte`, `$lte`, `$in`, `$notIn`, `$contains`, `$startsWith`, `$isNull`. **There is no `$eq`/`$ne` operator at all** — equality is the bare value; there is no explicit "not equal" operator, work around it with `$notIn: [value]`.

### Escape hatches

`getAdapter()` is a method on a specific repository, not a standalone import:

```ts
// Transactions / raw SQL
const rows = await db.comments.getAdapter().query<{ total: number }>(
  "SELECT page_route, COUNT(*) as total FROM comments GROUP BY page_route ORDER BY total DESC LIMIT 10"
);
```

Use for: transactions, `GROUP BY`/aggregates, joins, field-to-field comparisons — expected paths for these, not workarounds.

### DB backend auto-detection

Exact precedence (`src/db/adapters/mod.ts`'s `createDbAdapter()`):

1. `DUNE_DB_URL` starts with `postgres://` or `postgresql://` → **PostgreSQL**
2. Else `DENO_DEPLOYMENT_ID` is set → **Deno KV**
3. Else → **SQLite** at `DUNE_DB_PATH` (default `data/dune.db`)

Non-ID `where` clauses on the KV adapter are full scans — fine for small datasets, switch to Postgres for larger ones.

---

## No admin UI for `schemas/*.yaml` models

**There is no generated admin panel UI for DB-backed schema models, at all.** Grep `@dune/plugin-admin`'s routes for `schemas/`/`DbSchema` and you get zero hits — only Flex Object routes (`admin/routes/flex/`) exist for admin CRUD UI. If you need editors to manage records through `/admin`, use Flex Objects instead, or build your own admin UI page (`adminPages` — see `dune-plugin-authoring`) against the generated repository.

---

## CRUD API generation

```yaml
# schemas/comments.yaml
model: Comment
fields: { /* ... */ }
api:
  enabled: true          # optional, default true
  auth: required          # REQUIRED field — "none" | "required" | "owner" — no default, parser throws if omitted
  ownerField: authorId    # required when auth: "owner"
  methods: [get, list, create, update]  # optional — restrict from the default five
  writable: [body]       # required when methods includes create or update (deny-by-default)
```

`dune codegen` generates route handlers at `src/routes/api/{table}/index.ts` (list + create) and `src/routes/api/{table}/[id].ts` (get, update, delete). Update is `PUT`, not `PATCH`:

```
GET    /api/comments        list
POST   /api/comments        create
GET    /api/comments/:id    get
PUT    /api/comments/:id    update   (not PATCH)
DELETE /api/comments/:id    delete
```

`auth: owner` filters list results to the current user's own records (matched via `ownerField`) and rejects updates/deletes on records owned by someone else.

---

## Gotchas

**There is no `store:` field, and no file-backed mode in this system.** Don't write `store: local`/`store: db` — the parser doesn't recognize a `store` key at all. Need file-backed, editor-managed content instead? That's Flex Objects, a different system with its own schema location (`flex-objects/`).

**There is no `nullable` field option.** Only `required` controls presence.

**`update`/`delete` take a positional `id`, not a `{ where, data }` object.** `db.comments.update(id, data)` / `db.comments.delete(id)`. Both return `{ count: number }` — check `count === 0` to detect a missing record. There's no bulk `where`-based delete on the standard Repository API.

**`where` operators are `$`-prefixed and there's no `$eq`/`$ne`.** Equality is the bare value; use `$notIn: [x]` if you need "not equal to x".

**`orderBy` is single-field only.** Bare `"createdAt"` (ascending) or `["createdAt", "desc"]` (tuple) — there's no multi-field sort array.

**`dune codegen` never touches `deno.json`.** No import-map alias is written automatically. Verify `@/db` (or whatever alias you use) actually resolves before assuming it does.

**Migrations live in `data/migrations/`, and the apply command is `dune migrate:run`.** Not `migrations/` (no `data/` prefix) and not bare `dune migrate` — both are easy typos from adjacent, similarly-named commands.

**Use `upsert` instead of find-then-create.** A `find` followed by a conditional `create` is a TOCTOU race under concurrent requests; `upsert(where, data)` is atomic.
