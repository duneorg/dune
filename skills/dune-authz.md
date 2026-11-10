# Skill: Dune Authorization (Polizy)

Authorization in Dune uses [polizy](https://github.com/bratsos/polizy) — a Zanzibar-inspired relationship-based model. **The schema is fixed and internal to `@dune/core`** — there is no site-authored `defineSchema()` step. `authz_store` just picks where tuples are persisted (flat files or a DB); it does not let you redefine what actions/relations exist. A plugin can add actions with `authzActions`, nothing more.

**Read `dune-auth` first.** Core creates the authz system whenever the site needs one: a plugin provides `editor.session` (the admin does), a plugin declares `authzActions`, or `site.yaml` has an `auth:` block. A site with none of those has no authz system, and every check below fails closed (deny) except content gating, which falls back to a direct `roles[]` check (see "Content gating").

---

## The real schema (fixed, not yours to define)

`src/auth/authz-schema.ts` (internal to `@dune/core`) defines everything:

- **Relations**: `member` (group membership, used for content gating), `admin`/`editor`/`author` (admin-tier roles), `owner` (per-resource grant).
- **Actions → relations**: `access` (satisfied by `member`/`admin`/`editor`/`author` — deliberately excludes `owner`, so owning one page doesn't grant general gated-content access), `edit` (satisfied by `owner`/`admin`/`editor`), and the full `AdminPermission` set mirrored 1:1 — `pages.create/read/update/delete`, `media.upload/read/delete`, `users.create/read/update/delete`, `config.read/update`, `submissions.read/delete`.
- **Subject types**: `user` and `group`. **Object types**: `group`, `app`, `resource`.
- **The site resource**: every site-wide permission is checked on `{ type: "app", id: "site" }` (`SITE_RESOURCE`, exported from `@dune/core`). It names what is protected, not who administers it, so it is the same with or without an admin plugin. (It was `app:admin` before 0.36.)

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

`initAuthz(storage)` must be called once, yourself, before `getAuthz()` works anywhere — there's no automatic initialization of this specific file. Its own generated header comment says as much: "In most cases you don't need this file — Dune wires authz automatically." Dune's own instance (the one core, the admin and the public login share) is separate from this one. This file exists for reaching authz from your own custom code (e.g. a hand-written API route). As long as `authz_store`/`dataDir` match, both instances read and write the same underlying flat files in `data/permissions/` — so grants are consistent in practice, but they are two separate `AuthSystem` objects, not one shared singleton. A plugin should not scaffold this file: it receives `services.authz` and `runtime.authz` instead.

There is no `import { authz } from "@/auth/authz.ts";` bare-constant pattern — use `getAuthz()` (after `initAuthz()` has run).

---

## Config

```yaml
# site.yaml
auth:
  authz_store: local    # default — data/permissions/*.json, rebuilt into an in-memory Map on startup (no Deno KV involved)
  # authz_store: db    # opt-in — requires a real database adapter (DUNE_DB_URL/DUNE_DB_PATH), not a separate "schema layer" feature
```

`authz_store` is independent of `user_store` (from `dune-auth`) — you can have `user_store: session` and `authz_store: local`.

---

## Common check patterns

All checks are async. Always `await`. **Mind which user type you're checking** — admin-panel actions use the admin user's id (from plugin-admin's own `AdminState.auth`, a completely separate identity from public site users); group membership / content gating / resource grants use the public `ctx.state.siteUser.id` (not `ctx.state.user` — see `dune-auth`).

### Site-wide permissions (editing, admin panel)

```ts
const canEdit = await getAuthz().check({
  who: { type: "user", id: userId },     // an admin account, or a site user: both are User records
  canThey: "pages.update",               // or "access", "config.update", ...
  onWhat: { type: "app", id: "site" },   // SITE_RESOURCE
});
```

Who holds what: a **site user** gets their admin-tier role (`admin`/`editor`/`author` in `roles[]`) through the role's group: Dune writes `(group:<role>, <role>, app:site)` at startup (`bootstrapRoleGrants`), as `system.role_grants` in `system.yaml` says: a mapping of group to relation, default `admin: admin, editor: editor, author: author`. Remap your own group (`staff: editor`), keep a subset, or `{}` for none; grants no longer configured are revoked at start and the user is a `member` of `group:<role>`. The **admin plugin's own accounts** get direct tuples (`services.authz.seedAdminTuples([{ id, role }])` from a plugin). Either way `authz.check()` answers the same, so a signed-in site user with the `editor` role may edit inline with no admin plugin installed.

You rarely call this yourself: the admin's route guards (`requirePermission`) and core's inline-edit gate already do, and deny when `authz` is undefined. There is no role-table fallback.

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

Core wires its authz system into the gating layer (`setGatingAuthz()`, from `mountDuneAuth()`) whenever the site has an `auth:` block, so checks go through `authz.check()` with full group support. **When none is wired, gating falls back to a direct `siteUser.roles[]` array check — same semantics, no polizy dependency.** That fallback is deliberate (`src/auth/gating.ts`), not a degraded mode to route around.

Unauthenticated users are redirected to `/auth/login`. Authenticated users without the required role get a 403.

**Do not add a manual `authz.check()`/roles check in `_middleware.ts` for a page that already has `roles:` frontmatter.** The page middleware handles it. Doubling up risks inconsistent behavior between the two checks.

---

## Bootstrap path (existing users → tuples)

Tuples are derived data: core rebuilds them from the user records at every start, idempotently. Three functions in `src/auth/authz.ts` (don't conflate them):

- **`bootstrapRoleGrants(authz, adapter)`** — once per start: grants each admin-tier role to its group on the site resource, `(group:admin|editor|author, <role>, app:site)`. This is what lets a site user's role carry `pages.update` with no per-user tuple.
- **`bootstrapRoleTuples(authz, adapter, siteUsers)`** — makes every user a `member` of `group:<role>` for each entry of their `roles[]` (plural array). Runs at start for existing site users.
- **`bootstrapAdminTuples(authz, adapter, adminUsers)`** — direct `(user, <role>, app:site)` tuples for the admin plugin's own accounts, reached through `services.authz.seedAdminTuples()`. Idempotent. A bootstrap that never runs `mountPlugins()` (`dune mcp:serve`'s lightweight one, for instance) does not run it.

**Role edits apply live, no restart.** A user store obtained from the site login or from `services.users.createLocalStore()` is wrapped (`withRoleSync`, `syncUserRoles`) so create, update of `roles` and delete keep the group memberships in step with `roles[]`; `dune users:create` and `dune users:grant-role` do the same. If you write user JSON files by hand, the change is picked up at the next start.

Because tuples are rebuilt from `roles[]`, `roles[]` is the thing to edit for a role: a tuple you add by hand for an admin-tier role is not a durable grant. Use `authz.allow()`/`addMember()` for extra grants (a payment, a resource owner) that `roles[]` does not express.

---

## Permission tuple storage

`authz_store: local` stores tuples one-per-file under `data/permissions/`:

```
data/permissions/{uuid}.json  →  { id, subject: {type, id}, relation, object: {type, id}, condition?, hmac? }
```

Rebuilt into an **in-memory `Map`** on startup (`AuthzLocalAdapter` — no Deno KV involved, despite the pattern elsewhere in Dune of using KV for hot-path indexes). `hmac` is only present when tuple signing is enabled — see the next Gotcha. Do not edit these files directly — use the `authz` API.

---

## Gotchas

**`authz.check()` is async — always await it.** Dropping the `await` returns a Promise, not a boolean, and your condition will always be truthy.

**`allow()` uses `toBe`, not `canThey`.** See "Grant a direct permission" above — this is a real, easy copy-paste mistake.

**Check the id of whoever is acting.** Admin accounts and site users are the same `User` record type with different sessions: an admin-panel request is identified by the admin session, a public-site request by `ctx.state.siteUser`. Use the id of the one you are authorising.

**There is no site-authored `defineSchema()` step.** The schema is fixed inside `@dune/core` (`src/auth/authz-schema.ts`). You cannot add new relations/actions to this system the way the polizy package's own generic docs might suggest for a from-scratch integration.

**Content gating's fallback is not a bug to work around.** With no authz system wired (a site with no `auth:` block and no admin), `roles:` frontmatter gating still works via a direct array check — it just doesn't get polizy's group behaviour. This is documented, deliberate behaviour in `src/auth/gating.ts`, not something broken that needs a manual `authz.check()` bolted on.

**`external-jwt` mode's relationship to authz tuples depends on `authz_store`.** With `authz_store` omitted (the default in this mode), roles come purely from the JWT's `roles` claim on every request — no local tuple store involved. Setting `authz_store: local` explicitly opts into a hybrid: Dune seeds group-membership tuples from the JWT on first appearance, then re-seeds whenever a per-request fingerprint of the JWT's roles changes (wiping and rebuilding via `disallowAllMatching`) — this lets you layer `authz.addMember()`/`allow()` grants (e.g. after a payment) on top of JWT-derived roles, since only the fingerprinted portion gets wiped on rotation. See `dune-docs`' authorization page for the full mechanism.

**HMAC signing of tuple files is opt-in, not automatic.** Set `DUNE_AUTHZ_HMAC_SECRET` (read via `loadHmacKeyFromEnv()`) to enable it. Without it, `dune serve` logs `authz.hmac.disabled` and tuple files are written unsigned — anyone with filesystem access could hand-edit or drop in a tuple file undetected. Decide deliberately, don't assume it's on by default. With a secret set, tuple files that were changed outside Dune need `dune authz:sign` before the next start accepts them.
