# Skill: Dune Plugin Authoring

Plugins extend Dune via hooks that fire at defined points in the content and request lifecycle. A plugin is a TypeScript module that exports a `DunePlugin` object. Agents frequently place plugin files in the wrong location or omit security guards on admin routes — both are addressed here.

---

## File location

```
plugins/
  my-plugin/
    mod.ts        ← entry point for multi-file plugins
    admin.ts      ← admin route handlers (optional, import from mod.ts)
    types.ts      ← shared types (optional)
  simple-plugin.ts  ← single-file plugins can live here directly
```

Dune does not scan `plugins/` automatically by default — plugins must be registered (see below). Do not place plugin files anywhere else in the project.

There *is* an opt-in auto-discovery mode (`src/plugins/loader.ts`): set `auto_discover_plugins: true` at the top level of `site.yaml` and every file directly under `plugins/` loads without a `plugins:` entry. It's off by default deliberately — the loader's own comment notes that loading an arbitrary `.ts` file out of that directory executes its module code at startup, so this is a real code-execution surface once enabled, same category of risk as the (also opt-in, also off-by-default) job auto-discovery covered in `dune-jobs`. Explicitly-declared plugins in `plugins:` always take priority over auto-discovered ones with the same effect.

---

## Registration

```yaml
# site.yaml
plugins:
  - src: ./plugins/my-plugin/mod.ts    # local plugin — relative to site root
  - src: jsr:@dune/blog@^1.2.0         # JSR plugin — pin the version
  - src: npm:dune-comments@^2.0.0      # npm plugin — pin the version
```

Everything uses `src:` — there is no separate `spec:` key. `PluginEntry` (`src/config/dune-config.ts`) has one required field; whether it's local or remote is inferred entirely from the value's prefix (`jsr:`, `npm:`, `https:`, or a bare/`./`-relative path). A plugin entry written with `spec:` instead of `src:` won't load — the loader only ever reads `entry.src`, so it resolves to `undefined` and fails. `dune validate` requires remote (`jsr:`/`npm:`/`https:`) specs to include a version pin.

A plugin entry also accepts an optional sibling `config:` block for static, per-plugin settings:

```yaml
plugins:
  - src: "jsr:@dune/plugin-seo"
    config:
      defaultDescription: "My site"
```

Read it back inside any hook via `ctx.config.plugins["my-plugin"]` (keyed by the plugin's own `name`, not the `src:` specifier) — it's merged into `DuneConfig.plugins` at load time. There's no `ctx.config.plugins` shortcut scoped to just "your own" plugin; you look yourself up by name like anyone else would.

---

## Minimal plugin shape

```ts
// plugins/my-plugin/mod.ts
import type { DunePlugin } from "@dune/core";

export default {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {},
} satisfies DunePlugin;
```

`satisfies DunePlugin` catches shape errors at compile time. Always use it.

---

## Hook context

Every hook handler takes **one** argument — a `HookContext<T>` — not `(ctx, page)`:

```ts
interface HookContext<T> {
  event: HookEvent;
  data: T;                    // event-specific payload — shape depends on which hook fired
  config: DuneConfig;
  storage: StorageAdapter;
  stopPropagation: () => void; // stop later hooks for this event from running
  setData: (data: T) => void;  // replace the payload the next hook in the chain sees
  jobs?: { run(name: string): Promise<void> }; // only set while the job scheduler is running
}
```

There is **no** `content`, `email`, `db`, or `logger` field on this context — nothing is injected for you beyond `config`/`storage`. If your hook needs one of those:

- **Logging** — import the shared logger directly: `import { logger } from "@dune/core/logger";` then `logger.info("my_plugin.event", { ... })`. It isn't handed to you via `ctx`.
- **Email** — construct your own client in `setup()` and close over it in your hooks: `createEmailClient()`/`createEmailProvider()` from `@dune/core/email`.
- **Content queries** — hooks don't get a queryable content API at all. `onContentIndexReady`'s `data` is the raw `PageIndex[]` already built by the index — filter/map that array directly. If you need `engine.find()`-style queries, that's only reachable from `mount()`'s `bootstrap.engine` (see "Admin routes" above), not from a regular hook.
- **`db`** — there is no `ctx.db`, period, regardless of configuration. A plugin that needs the data layer imports `@dune/core/db` directly and builds its own repos from `schemas/*.yaml`, same as any other module.

`data`'s shape is different per event — some examples: `onConfigLoaded` → `DuneConfig`; `onContentIndexReady` → `PageIndex[]`; `onRequest` → `Request` directly (not wrapped); `onPageCreate`/`onPageUpdate` → `{ sourcePath: string, title: string }`; `onPageDelete` → `{ sourcePath: string }`; `onWorkflowChange` → `{ sourcePath, from, to }` (`WorkflowStatus`). Check `src/hooks/types.ts`'s `HookEvent` union and the actual `hooks.fire()` call site for a given event (not just the docs) for its real shape — see the note below on hooks that are declared but never fired.

---

## Common hook patterns

### React to the content index

```ts
import { logger } from "@dune/core/logger";

// ...

hooks: {
  onContentIndexReady: async (ctx) => {
    // ctx.data is the raw PageIndex[] — no query API, just filter/map it
    const posts = ctx.data.filter((p) => p.sourcePath.startsWith("02.blog/"));
    logger.info("my_plugin.content_indexed", { postCount: posts.length });
  },
}
```

### React when a page is deleted

```ts
hooks: {
  onPageDelete: async (ctx) => {
    // ctx.data is { sourcePath: string } — not a full Page object
    const { sourcePath } = ctx.data;
    await myDb.comments.delete({ where: { pageSourcePath: sourcePath } });
  },
}
```

### Send email on a content event

```ts
// plugins/my-plugin/mod.ts
import type { DunePlugin, PluginApi } from "@dune/core";
import { createEmailClient, createEmailProvider } from "@dune/core/email";

let email: ReturnType<typeof createEmailClient>;

export default {
  name: "my-plugin",
  version: "1.0.0",
  setup(api: PluginApi) {
    // Deliberately synchronous — see the gotcha below on why setup()
    // must not be the thing your hooks are waiting on to finish.
    const provider = createEmailProvider({
      provider: "resend",
      from: "hello@example.com",
      resend: { apiKey: Deno.env.get("RESEND_API_KEY")! },
    });
    email = createEmailClient({ provider, from: "hello@example.com" });
  },
  hooks: {
    onPageCreate: async (ctx) => {
      await email.send({
        to: "list@example.com",
        subject: `New page: ${ctx.data.title}`,
        html: `<p>${ctx.data.sourcePath} was just created.</p>`,
      });
    },
  },
} satisfies DunePlugin;
```

### Intercept a request before routing

```ts
hooks: {
  onRequest: ({ data: req, setData, stopPropagation }) => {
    // data is the raw Request itself — not wrapped in { req }
    const url = new URL(req.url);
    if (url.pathname === "/api/status") {
      setData(Response.json({ ok: true, ts: Date.now() }));
      stopPropagation(); // short-circuits Dune's normal routing
    }
  },
}
```

### Register hooks conditionally from `setup()`

The static `hooks: {}` object on `DunePlugin` isn't the only way to register a handler. `PluginApi.hooks` (the registry passed into `setup()`) has real `on(event, handler)`/`off(event, handler)` methods for registering — or later removing — a handler dynamically, e.g. only when a plugin's own config enables a feature:

```ts
export default {
  name: "edge-cache",
  version: "1.0.0",
  hooks: {}, // still required, even when everything is registered dynamically
  setup({ hooks, config }) {
    const purgeUrl = (config.plugins["edge-cache"]?.purgeUrl) as string | undefined;
    if (!purgeUrl) return; // feature not configured — register nothing

    hooks.on("onCacheInvalidate", async () => {
      // Real payload is {} — no per-key data. Every fire() call site for
      // this event (src/core/engine.ts's onRebuild-adjacent invalidation,
      // plugin-admin's theme-config save route) passes an empty object;
      // it's a "the whole page cache is stale" signal, not scoped to one key.
      await fetch(purgeUrl, { method: "POST" });
    });
  },
} satisfies DunePlugin;
```

`hooks: {}` on the plugin object is still required (`DunePlugin.hooks` isn't optional) even if you register everything dynamically through `setup()` instead.

**Not every hook name declared in the `HookEvent` union is actually fired.** As of this writing, `onRouteResolved`, `onPageLoaded`, `onCollectionResolved`, `onBeforeRender`, `onAfterRender`, `onResponse`, `onMarkdownProcess`, `onMarkdownProcessed`, `onMediaDiscovered`, `onCacheHit`, `onCacheMiss`, `onApiRequest`, and `onApiResponse` are declared as valid `HookEvent` values and pass `dune validate`'s hook-name check, but no code anywhere in `@dune/core` or `@dune/plugin-admin` ever calls `hooks.fire()` for them — a handler registered for one of these is simply never invoked. Verify a hook is actually live before building on it: `grep -rn '"eventName"' src/ | grep -v hooks/types.ts` in the core repo (and the same in `plugin-admin/`) — if the only hits are the type declaration and the validator's allowlist, it's dead. Confirmed live as of this writing: `onConfigLoaded`, `onStorageReady`, `onContentIndexReady`, `onRequest`, `onCacheInvalidate`, `onRebuild`, `onThemeSwitch`, `onSearchRecordsCollect`, `onSearchEngineCreate`, `onPageCreate`, `onPageUpdate`, `onPageDelete`, `onWorkflowChange`.

---

## Admin routes

There is no `onAdminRoutes` hook, and `@dune/core` does not export `requirePermission`/`csrfCheck` — plugin authors sometimes assume these exist because plugin-admin's own internal admin routes use functions with those names, but those live in `@dune/plugin-admin`'s private `src/admin/routes/api/_utils.ts` and are not part of any published, importable API. Attempting `import { requirePermission } from "@dune/core"` fails — the specifier doesn't resolve.

There are two real, supported ways for a plugin to add admin routes:

### `adminPages` — authenticated GET pages (the normal case)

Each entry adds a route under the admin prefix that's rendered inside the admin shell (sidebar, header) automatically. Auth and the optional `permission` check are both enforced by the mount code — the handler itself does not need to check anything.

```ts
// plugins/my-plugin/mod.ts
import type { DunePlugin } from "@dune/core";

export default {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {},
  adminPages: [
    {
      path: "/my-plugin",              // relative to the admin prefix → /admin/my-plugin
      label: "My Plugin",
      icon: "🧩",
      permission: "pages.read",        // optional — omit to allow any authenticated admin
      handler: async (ctx) => {
        return ctx.render(
          <div>
            <h1>My Plugin</h1>
          </div>,
        );
      },
    },
  ],
} satisfies DunePlugin;
```

`path` is relative to the admin prefix (mount code does `adminPrefix + page.path`) — do not include `/admin` yourself, or you'll register `/admin/admin/my-plugin`. GET only; there's no declarative way to register a mutation route this way.

### `mount()` — anything else (mutation routes, custom middleware)

For a `POST`/`PUT`/`DELETE` route, or anything `adminPages` doesn't cover, register directly on the real Fresh `app` via `mount()`:

```ts
// plugins/my-plugin/mod.ts
import type { DunePlugin, MountApi } from "@dune/core/plugins";

export default {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {},
  async mount({ app }: MountApi) {
    app.post("/admin/api/my-plugin/action", async (fc) => {
      // No shared requirePermission()/csrfCheck() helper is exported for
      // plugin-registered routes — those exist only inside
      // @dune/plugin-admin's own private route tree. A route registered
      // here via mount() is NOT automatically authenticated, unlike
      // adminPages. You are responsible for your own auth/permission/CSRF
      // checks, or for keeping mutations behind an existing guarded admin
      // API endpoint instead of writing a new raw route.
      return Response.json({ ok: true });
    });
  },
} satisfies DunePlugin;
```

**This is a real gap, not an oversight to work around with an import that doesn't exist.** If your plugin only needs to *display* data or trigger something a human clicks through in the admin UI, prefer `adminPages` — you get auth and permission enforcement for free. Reach for `mount()`-registered mutation routes only when you actually need them, and treat the missing guard as your plugin's responsibility to implement, not Dune's to hand you.

### `publicRoutes` — declarative public-facing routes

For routes on the *public* site (not under the admin prefix), `publicRoutes` is a simpler declarative alternative to registering them yourself via `mount()`:

```ts
export default {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {},
  publicRoutes: [
    {
      path: "/newsletter/confirm",
      method: "GET",              // "GET" | "POST" | "PUT" | "DELETE" | "ALL" — default "GET"
      handler: async (ctx) => {
        const token = ctx.url.searchParams.get("token");
        return ctx.render(<ConfirmPage token={token} />);
      },
      island: new URL("./islands/ConfirmPage.tsx", import.meta.url).pathname, // optional
    },
  ],
} satisfies DunePlugin;
```

Registered before Dune's content catch-all, so a `publicRoutes` entry takes priority over a content page at the same path. Handlers get a full Fresh context (`ctx.render()`, islands, middleware) — unlike `mount()`, you don't need the raw `app` reference. These routes are **not** admin-guarded (no permission check, no auth) — that's the tradeoff for being public in the first place; add your own check inside the handler if the route needs one.

**Both `publicRoutes` and `adminPages` are wired up by `@dune/plugin-admin`'s own `mount()`** (`plugin-admin/src/admin/mount.ts`), not by anything in `@dune/core`'s routing directly — `DunePlugin.publicRoutes`/`.adminPages` are core types, but nothing in core reads them. In the normal `dune serve`/`dune dev` path this is transparent: `bootstrap()` auto-registers `@dune/plugin-admin` as a plugin whenever `admin.enabled !== false` (the default), and its `mount()` runs like any other plugin's, wiring both features up before you'd notice. It stops being transparent if `admin.enabled: false` (no admin plugin registered → your `publicRoutes`/`adminPages` are silently never wired) or in headless mode, where wiring only happens if the site's own `main.ts` calls `mountDuneAdmin(app, ctx)` (see `dune-content`'s Agent-tooling section / the Headless Mode doc) — skip that call and both features go dark with no error.

### Permission reference

Real values of the `AdminPermission` union (`plugin-admin/src/admin/types.ts`) — `adminPages[].permission` accepts any string but only these are meaningful against the built-in role table:

| Permission string | Grants |
|--------------------|--------|
| `"pages.create"` / `"pages.read"` / `"pages.update"` / `"pages.delete"` | Content page CRUD |
| `"media.upload"` / `"media.read"` / `"media.delete"` | Media library |
| `"users.create"` / `"users.read"` / `"users.update"` / `"users.delete"` | User management |
| `"config.read"` / `"config.update"` | Site config |
| `"submissions.read"` / `"submissions.delete"` | Form submissions |
| `"admin.access"` | Any authenticated admin (no finer check) |

There is no `"pages.view"`, `"users.manage"`, or `"plugins.manage"` — use the split create/read/update/delete permissions above.

Use the most restrictive permission that still allows the action.

---

## Testing a plugin

Use the plugin integration harness. It boots a real in-memory Dune instance and gives you `fetch()`/`render()` against the read-only content API (`/api/*`) — not arbitrary page routes or the admin API:

```ts
import { createTestHarness } from "@dune/testing";
import { assertEquals } from "@std/assert";
import myPlugin from "./plugins/my-plugin/mod.ts";

Deno.test("my plugin", async () => {
  const h = await createTestHarness({
    content: {
      "01.home/default.md": "---\ntitle: Home\n---\nHello",
    },
    plugins: [myPlugin],
  });

  try {
    const res = await h.fetch("/api/pages");
    assertEquals(res.status, 200);
  } finally {
    await h.dispose();
  }
});
```

`h.render(path)` is shorthand for `(await h.fetch(path)).text()` — both only reach the content API, since the harness runs without the admin plugin by default (`disableAdmin: true`). For a full page route (`/home`) or an admin/mount()-registered route, use the Playwright E2E suite against a real server instead — the harness can't reach either.

---

## Gotchas

**Wrong file location.** Plugin files must be in `plugins/`. Placing them in `src/`, `routes/`, or the project root means they won't be found by `dune validate` and the plugin spec won't resolve correctly.

**There is no `requirePermission`/`csrfCheck` import for plugin authors.** Those names exist only inside `@dune/plugin-admin`'s private route tree, not in any public export. A `mount()`-registered mutation route is unauthenticated by default — you must implement your own checks, or use `adminPages` (GET-only, auto-guarded) instead.

**`adminPages` paths are relative to the admin prefix.** `path: "/my-plugin"` → `/admin/my-plugin`. Writing `path: "/admin/my-plugin"` double-prefixes to `/admin/admin/my-plugin`.

**There is no `ctx.db` on any hook, ever.** `HookContext` only has `event`, `data`, `config`, `storage`, `stopPropagation`, `setData`, and an optional `jobs`. If your plugin needs the data layer, import `@dune/core/db` directly — it's never injected, regardless of config.

**`mount()` runs once at startup, after the Fresh `App` is ready.** Register routes and middleware there; don't rely on it for per-request async work — that belongs in the route handlers themselves.

**Hook error handling is not uniform — check the caller before assuming.** `HookRegistry.fire()` itself (`src/hooks/registry.ts`) has no try/catch around handler calls. Whether a throwing hook is contained depends entirely on who calls `fire()`: the admin panel's page CRUD routes (`onPageCreate`/`onPageUpdate`/`onPageDelete`/`onWorkflowChange`) call it as `hooks.fire(...).catch(() => {})` — errors are silently swallowed, not even logged. Startup and engine-lifecycle hooks (`onConfigLoaded`, `onStorageReady`, `onContentIndexReady`, `onRebuild`, `onThemeSwitch`) are `await`ed directly with no catch — a throwing handler there propagates and can fail bootstrap or a rebuild. Don't assume either behavior; if a hook has a side effect that must succeed or must not silently vanish, handle its own errors explicitly and log them yourself.

**Pin JSR/npm plugin versions.** `src: jsr:@dune/blog` without a version pinned fails validation. Use `^major.minor.patch` at minimum.

**`setup()`'s returned Promise is fire-and-forget — the registry does not await it before hooks can fire.** `registerPlugin()` (`src/hooks/registry.ts`) calls `plugin.setup(api)` synchronously and, if it returns a Promise, only attaches a `.catch()` for error logging — it does not block registration or hook dispatch on it resolving. If your `setup()` needs to `await` something (a network call, a file read) before your plugin is actually ready, a hook can fire in that window and see whatever state `setup()` hadn't gotten around to initializing yet. Keep `setup()` synchronous when you can (as in the email example above — `createEmailClient`/`createEmailProvider` are both sync); if you genuinely need async initialization, the registry's own doc comment says to subscribe to `onContentIndexReady` instead of relying on `setup()` completing first.
