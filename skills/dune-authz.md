# Skill: Dune Authorization (Polizy)

Authorization in Dune uses [polizy](https://github.com/bratsos/polizy) — a Zanzibar-inspired relationship-based model. One `authz.check()` call covers everything: admin panel access, inline editing, content gating, route middleware, and resource-level permissions.

For polizy's core concepts (`defineSchema()`, tuple model, check algorithm, `listAccessibleObjects`), see the polizy skills installed alongside this one. This skill covers Dune-specific wiring and patterns.

---

## The single authz file

`src/auth/authz.ts` is scaffolded by `dune add polizy`. Do not create it manually. It has two sections:

```ts
// src/auth/authz.ts

import { AuthSystem, defineSchema } from "polizy";
import { AuthzLocalAdapter } from "@dune/core";  // or AuthzDbAdapter

// Section 1: schema — store-agnostic, defines relations/actions/hierarchy
const schema = defineSchema({
  // ... see polizy skill for defineSchema() syntax
  // Dune's default schema covers: admin, editor, author, member, owner
  // Actions: access, pages.update, users.manage, media.upload, edit, ...
});

// Section 2: AuthSystem — wires the adapter from authzStore config
export const authz = new AuthSystem({
  schema,
  storage: new AuthzLocalAdapter(),  // swapped to AuthzDbAdapter when authzStore: db
});
```

Import `authz` from this file everywhere permission checks are needed:

```ts
import { authz } from "@/auth/authz.ts";
```

---

## Config

```yaml
# site.yaml
auth:
  mode: dune
  authzStore: local    # default — data/permissions/*.json + Deno KV index
  # authzStore: db     # opt-in — requires db-schema-layer
```

`authzStore` is independent of `userStore`. You can have `userStore: session` and `authzStore: local`.

---

## Common check patterns

All checks are async. Always `await`.

### Admin panel access

```ts
const canAdmin = await authz.check({
  who: { type: "user", id: ctx.state.user.id },
  canThey: "access",
  onWhat: { type: "app", id: "admin" },
});
```

### Group membership (content gating, membership sites)

```ts
const isMember = await authz.check({
  who: { type: "user", id: ctx.state.user.id },
  canThey: "access",
  onWhat: { type: "group", id: "member" },
});
```

### Inline editing / resource-level permission

```ts
const canEdit = await authz.check({
  who: { type: "user", id: ctx.state.user.id },
  canThey: "edit",
  onWhat: { type: "resource", id: pageRoute },
});
```

### Specific admin action

```ts
const canManageUsers = await authz.check({
  who: { type: "user", id: ctx.state.user.id },
  canThey: "users.manage",
  onWhat: { type: "app", id: "admin" },
});
```

---

## Granting permissions

### Add user to a group

```ts
await authz.addMember({
  member: { type: "user", id: userId },
  group: { type: "group", id: "member" },
});
```

Call this on successful OAuth login or payment to grant group access.

### Grant a direct resource permission

```ts
await authz.allow({
  who: { type: "user", id: userId },
  canThey: "edit",
  onWhat: { type: "resource", id: pageRoute },
});
```

Use for per-resource grants (e.g., an OAuth user who is the owner of a specific page).

---

## Content gating via frontmatter

For pages with `roles:` frontmatter, the check runs automatically in Dune's page middleware — **do not wire this manually**.

```yaml
# content/members/welcome.md
---
roles: member
---
```

```yaml
roles: [member, admin]        # OR — any of these is sufficient
roles:
  all: [member, verified]     # AND — user must belong to every group
```

Unauthenticated users are redirected to `/auth/login`. Authenticated users without the required role get a 403.

---

## Route middleware pattern

For programmatic route protection (not frontmatter-based):

```ts
// routes/dashboard/_middleware.ts
import { FreshContext } from "fresh";
import { authz } from "@/auth/authz.ts";

export async function handler(req: Request, ctx: FreshContext) {
  if (!ctx.state.user) {
    return Response.redirect(new URL("/auth/login", req.url));
  }
  const allowed = await authz.check({
    who: { type: "user", id: ctx.state.user.id },
    canThey: "access",
    onWhat: { type: "group", id: "member" },
  });
  if (!allowed) return new Response(null, { status: 403 });
  return ctx.next();
}
```

---

## Bootstrap path (existing admin users)

On first startup after polizy is introduced, Dune derives initial tuples from the `role` field on existing user files (`admin | editor | author`). No manual migration step.

```json
// data/users/alice.json
{ "id": "alice", "email": "alice@example.com", "role": "editor" }
```

→ Dune creates tuples equivalent to `authz.allow({ who: user:alice, canThey: "access", onWhat: app:admin })` and the editor-level action grants on first run.

From then on, **tuples are the authority**. The `role` field becomes a legacy hint. Use `authz.allow()` and `authz.addMember()` to manage permissions going forward.

---

## Permission tuple storage

`authzStore: local` stores tuples as JSON files:

```
data/permissions/
  {id}.json   →  { id, subject, relation, object, condition? }
```

The Deno KV index covers hot lookup paths. If KV is lost, it rebuilds from files on startup (mtime comparison). Do not edit these files directly — use `authz.allow()`, `authz.addMember()`, `authz.revoke()` etc.

---

## Gotchas

**`authz.check()` is async — always await it.** It makes multiple storage calls. Dropping the `await` returns a Promise, not a boolean, and your condition will always be truthy.

**Do not manually check `ctx.state.user.roles` for group membership.** In `userStore: local` or `db` mode, `roles` reflects current group membership but going through `authz.check()` is the correct path — it handles hierarchy and inheritance. Direct `roles` array inspection bypasses that.

**Content-gated pages: do not add manual `authz.check()` in `_middleware.ts`.** The page middleware reads `roles:` frontmatter and calls `authz.check()` automatically. Doubling up results in two checks and potentially inconsistent behavior.

**`external-jwt` mode: authz tuples are irrelevant for roles.** In `external-jwt` mode, `ctx.state.user.roles` comes from JWT claims. `authz.addMember()` writes to the local/db tuple store, which is never consulted in this mode. Don't mix the two.

**`src/auth/authz.ts` schema is yours to maintain.** `dune add polizy` scaffolds it; after that it's application code. When you add a new relation or action, update `defineSchema()` here. The adapter doesn't need to change.
