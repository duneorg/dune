# Skill: Dune Authorization (Polizy)

Authorization in Dune uses [polizy](https://github.com/bratsos/polizy) — a Zanzibar-inspired relationship-based model. **The schema is fixed and internal to `@dune/core`** — there is no site-authored `defineSchema()` step. `authzStore` just picks where tuples are persisted (flat files or a DB); it does not let you redefine what actions/relations exist.

**Read `dune-auth` first.** Everything here about admin-panel checks, route middleware, and resource grants going through a live `authz` instance depends on `mountDuneAuth()` being called — and as documented in that skill, `mountDuneAuth()` currently has no public export from `@dune/core` and is never auto-called. Content gating (`roles:` frontmatter) still works without it, via a documented fallback — see "Content gating" below — but the wired-`authz.check()` path for everything else is presently unreachable the same way public auth is.

---

## The real schema (fixed, not yours to define)

`src/auth/authz-schema.ts` (internal to `@dune/core`) defines everything:

- **Relations**: `member` (group membership, used for content gating), `admin`/`editor`/`author` (direct admin-tier roles), `owner` (per-resource grant).
- **Actions → relations**: `access` (satisfied by `member`/`admin`/`editor`/`author` — deliberately excludes `owner`, so owning one page doesn't grant general gated-content access), `edit` (satisfied by `owner`/`admin`/`editor`), and the full `AdminPermission` set mirrored 1:1 — `pages.create/read/update/delete`, `media.upload/read/delete`, `users.create/read/update/delete`, `config.read/update`, `submissions.read/delete`, plus a legacy `users.manage` action kept for backward compatibility (broader than `users.update`, covers create/delete too).
- **Subject type**: `user` only. **Object types**: `group`, `app`, `resource`.

There is no `"pages.view"` — real is `"pages.read"`.

---

## Project-local `src/auth/authz.ts` (scaffolded by `dune add polizy`)

The scaffold is a lazy singleton wrapper, **not** a bare exported `authz` constant:

```ts
// src/auth/authz.ts — as actually scaffolded by `dune add polizy`
import { createDuneAuthSystem } from "@dune/core/auth/authz";
import type { StorageAdapter } from "@dune/core";

let _authz: ReturnType<typeof createDuneAuthSystem> | null = null;

export function initAuthz(storage: StorageAdapter, dataDir = "data") {
  _authz = createDuneAuthSystem({ authzStore: "local", dataDir }, storage);
  return _authz;
}

export function getAuthz() {
  if (!_authz) throw new Error("authz not initialised — call initAuthz() first");
  return _authz;
}
```

`initAuthz(storage)` must be called once, yourself, before `getAuthz()` works anywhere — there's no automatic initialization of this specific file. Its own generated header comment says as much: "In most cases you don't need this file — Dune wires authz automatically when `authzStore: local` is set" — referring to the *separate* internal instance `mountDuneAuth()` creates for the admin panel and content gating, not this file. This file exists for reaching authz from your own custom code (e.g. a hand-written API route) outside anything Dune already wires. As long as `authzStore`/`dataDir` match, both instances read and write the same underlying flat files in `data/permissions/` — so grants are consistent in practice, but they are two separate `AuthSystem` objects, not one shared singleton.

There is no `import { authz } from "@/auth/authz.ts";` bare-constant pattern — use `getAuthz()` (after `initAuthz()` has run).

---

## Config

```yaml
# site.yaml
auth:
  authzStore: local    # default — data/permissions/*.json, rebuilt into an in-memory Map on startup (no Deno KV involved)
  # authzStore: db     # opt-in — requires a real database adapter (DUNE_DB_URL/DUNE_DB_PATH), not a separate "schema layer" feature
```

`authzStore` is independent of `userStore` (from `dune-auth`) — you can have `userStore: session` and `authzStore: local`.

---

## Common check patterns

All checks are async. Always `await`. **Mind which user type you're checking** — admin-panel actions use the admin user's id (from plugin-admin's own `AdminState.auth`, a completely separate identity from public site users); group membership / content gating / resource grants use the public `ctx.state.siteUser.id` (not `ctx.state.user` — see `dune-auth`).

### Admin panel access

```ts
const canAdmin = await getAuthz().check({
  who: { type: "user", id: adminUserId },  // the ADMIN user's id, not ctx.state.siteUser
  canThey: "access",
  onWhat: { type: "app", id: "admin" },
});
```

In practice, `plugin-admin`'s own route guards don't call this directly for you — `requirePermission(ctx, perm)` (internal to `@dune/plugin-admin`) already does: it calls `authz.check()` when polizy is wired (`auth.mode: dune`, `authzStore: local`), and falls back to a simpler `ROLE_PERMISSIONS` table lookup when it isn't. You don't need to duplicate this in an admin route.

### Group membership (content gating, membership sites)

```ts
const isMember = await getAuthz().check({
  who: { type: "user", id: siteUserId },   // ctx.state.siteUser.id
  canThey: "access",
  onWhat: { type: "group", id: "member" },
});
```

### Resource ownership / inline editing

```ts
const canEdit = await getAuthz().check({
  who: { type: "user", id: siteUserId },
  canThey: "edit",
  onWhat: { type: "resource", id: pageRoute },
});
```

---

## Granting permissions

### Add a site user to a group

```ts
await getAuthz().addMember({
  member: { type: "user", id: siteUserId },
  group: { type: "group", id: "member" },
});
```

Call this on successful OAuth login or payment to grant group access.

### Grant a direct permission — `allow()` takes `toBe`, not `canThey`

```ts
await getAuthz().allow({
  who: { type: "user", id: siteUserId },
  toBe: "owner",                              // the relation being granted — not canThey
  onWhat: { type: "resource", id: pageRoute },
});
```

`allow()`'s field is `toBe` (the relation you're granting), unlike `check()`'s `canThey` (the action being asked about) — don't copy-paste a `check()` call into an `allow()` call without swapping the field name.

### Revoke

Dune's own code (`src/auth/webhook.ts`, on IdP user-deletion events) uses `authz.disallowAllMatching({ who: {...} })` to wipe all tuples for a user. That's the one revocation method confirmed in source — verify the exact polizy API for narrower revocations (single tuple vs. all-matching) against the installed `polizy` package version rather than assuming a name.

---

## Content gating via frontmatter

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
roles: []                     # authenticated-only — any logged-in site user
# roles absent                # public — no check performed
```

When a polizy `AuthSystem` has been wired into the gating layer via `setGatingAuthz()` (called from inside `mountDuneAuth()` — see the top of this file for why that's currently unreachable), checks go through `authz.check()` for full group-hierarchy support. **Without one wired — the current default state of every site — gating falls back to a direct `siteUser.roles[]` array check, same semantics, no polizy dependency.** This fallback is a deliberate, documented feature (`src/auth/gating.ts`), not a degraded mode to route around — but it means the hierarchy/inheritance behavior polizy would add isn't active until `mountDuneAuth()` is reachable and called.

Unauthenticated users are redirected to `/auth/login`. Authenticated users without the required role get a 403.

**Do not add a manual `authz.check()`/roles check in `_middleware.ts` for a page that already has `roles:` frontmatter.** The page middleware handles it. Doubling up risks inconsistent behavior between the two checks.

---

## Bootstrap path (existing users → tuples)

Two separate, real bootstrap functions (`src/auth/authz.ts`) — don't conflate them:

- **`bootstrapAdminTuples(authz, adapter, adminUsers)`** — for admin users (`data/users/*.json`, single `role: "admin" | "editor" | "author"` field). Grants a direct tuple: `authz.allow({ who: user, toBe: user.role, onWhat: { type: "app", id: "admin" } })`. Idempotent, called automatically by `bootstrap()` at startup — this one genuinely runs without you wiring anything, since it's part of admin auth (already fully wired, unlike public auth).
- **`bootstrapRoleTuples(authz, adapter, siteUsers)`** — for public site users (`SiteUser.roles: string[]`, plural array, not a single field). Grants group memberships via `authz.addMember()` for each role in the array. This one is only reachable through `mountDuneAuth()`, same caveat as everything else public-auth-related in this file.

From then on, tuples are the authority for whichever system was bootstrapped — admin `role`/site `roles[]` become legacy hints once tuples exist. Use `authz.allow()`/`addMember()` to manage permissions going forward, not by editing the role fields directly.

---

## Permission tuple storage

`authzStore: local` stores tuples one-per-file under `data/permissions/`:

```
data/permissions/{uuid}.json  →  { id, subject: {type, id}, relation, object: {type, id}, condition?, hmac? }
```

Rebuilt into an **in-memory `Map`** on startup (`AuthzLocalAdapter` — no Deno KV involved, despite the pattern elsewhere in Dune of using KV for hot-path indexes). `hmac` is only present when tuple signing is enabled — see the next Gotcha. Do not edit these files directly — use the `authz` API.

---

## Gotchas

**`authz.check()` is async — always await it.** Dropping the `await` returns a Promise, not a boolean, and your condition will always be truthy.

**`allow()` uses `toBe`, not `canThey`.** See "Grant a direct permission" above — this is a real, easy copy-paste mistake.

**Admin-panel checks use the admin user's id, not `ctx.state.siteUser.id`.** These are two completely separate identity systems (see `dune-auth`) — don't mix them into one "the current user" concept when calling `authz.check()`.

**There is no site-authored `defineSchema()` step.** The schema is fixed inside `@dune/core` (`src/auth/authz-schema.ts`). You cannot add new relations/actions to this system the way the polizy package's own generic docs might suggest for a from-scratch integration.

**Content gating's fallback is not a bug to work around.** Without `mountDuneAuth()` wired (the current default), `roles:` frontmatter gating still works via a direct array check — it just doesn't get polizy's hierarchy/inheritance behavior. This is documented, deliberate behavior in `src/auth/gating.ts`, not something broken that needs a manual `authz.check()` bolted on.

**`external-jwt` mode's relationship to authz tuples depends on `authzStore`.** With `authzStore` omitted (the default in this mode), roles come purely from the JWT's `roles` claim on every request — no local tuple store involved. Setting `authzStore: local` explicitly opts into a hybrid: Dune seeds group-membership tuples from the JWT on first appearance, then re-seeds whenever a per-request fingerprint of the JWT's roles changes (wiping and rebuilding via `disallowAllMatching`) — this lets you layer `authz.addMember()`/`allow()` grants (e.g. after a payment) on top of JWT-derived roles, since only the fingerprinted portion gets wiped on rotation. See `dune-docs`' authorization page for the full mechanism.

**HMAC signing of tuple files is opt-in, not automatic.** Set `DUNE_AUTHZ_HMAC_SECRET` (read via `loadHmacKeyFromEnv()`) to enable it. Without it, `dune serve` logs `authz.hmac.disabled` and tuple files are written unsigned — anyone with filesystem access could hand-edit or drop in a tuple file undetected. Decide deliberately, don't assume it's on by default.
