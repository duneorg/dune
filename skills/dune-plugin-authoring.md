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
  content?: ContentApi;        // only set once bootstrap() has built it — see below
}
```

There is **no** `email` or `db` field on this context — nothing is injected for you beyond `config`/`storage`/`content`/`jobs`. If your hook needs one of those:

- **Logging** — import the shared logger directly: `import { logger } from "@dune/core/logger";` then `logger.info("my_plugin.event", { ... })`. It isn't handed to you via `ctx`.
- **Email** — construct your own client in `setup()` and close over it in your hooks: `createEmailClient()`/`createEmailProvider()` from `@dune/core/email`.
- **`db`** — there is no `ctx.db`, period, regardless of configuration. A plugin that needs the data layer imports `@dune/core/db` directly and builds its own repos from `schemas/*.yaml`, same as any other module.

**`ctx.content` is the same `ContentApi` — `.pages()`, `.page()`, `.search()`, `.taxonomy()` — that `bootstrap.contentApi` exposes**, injected via `hooks.setContentApi()`. It's `undefined`, not a query-capable stub, for the handful of hooks that fire before `bootstrap()` finishes building it: `onConfigLoaded`, `onStorageReady`, `onContentIndexReady`, `onSearchRecordsCollect`, `onSearchEngineCreate`. Present for every other live hook (`onPageCreate`/`onPageUpdate`/`onPageDelete`/`onWorkflowChange`, `onRequest`, `onCacheInvalidate`, `onRebuild`, `onThemeSwitch`). **Also `undefined` on the lightweight, standalone `HookRegistry` instances `content:create` and `migrate:*` (with `--fire-hooks`) build outside a full `bootstrap()`** — those never call `setContentApi()` at all. `content:delete` is not in that group; it runs through a real `bootstrap()`, so its `onPageDelete` gets a working `ctx.content`. Always guard with `ctx.content?.` unless you've confirmed your specific hook only ever fires post-bootstrap. `onContentIndexReady`'s `data` (the raw `PageIndex[]`) is still the only thing available during the earliest bootstrap hooks — filter/map that array directly there instead.

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

### Query the content index from a hook

```ts
hooks: {
  onPageCreate: async (ctx) => {
    // ctx.content is undefined on content:create's standalone registry —
    // this pattern only works for hooks that fire through a full
    // bootstrap() (see the note above ctx.content's field, and the
    // dune-content skill for the full per-context breakdown).
    const related = await ctx.content?.search(ctx.data.title, { limit: 5 });
    // search() resolves the results array directly, not { results: [...] }
    logger.info("my_plugin.related_found", { count: related?.length ?? 0 });
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

**4 of 24 declared hook names in the `HookEvent` union are never fired.** `onRouteResolved`, `onPageLoaded`, `onAfterRender`, and `onResponse` remain declared but intentionally unimplemented — not overlooked, but genuine design questions with no clean fix:

- `onRouteResolved`/`onPageLoaded` describe a two-phase resolution (route matched to a lightweight `PageIndex`, then the full `Page` loaded) that doesn't exist in the current engine — `engine.resolve()` does both in one step and returns the full `Page` directly. Firing both as documented would mean fabricating a second event from data already in hand, or restructuring `resolve()` into two real phases.
- `onAfterRender`/`onResponse` need the actual rendered HTML string, but Fresh's `render()` returns a `Response` directly — core never sees the HTML itself. Getting it would mean intercepting and buffering every response body into memory via `response.text()`, killing streaming, as a blanket per-request cost whether or not any plugin is listening.

Both reasons are documented directly on the `HookEvent` type declaration in `src/hooks/types.ts`. Verify a hook is actually live before building on it: `grep -rn '"eventName"' src/ | grep -v hooks/types.ts` in the core repo (and the same in `plugin-admin/`) — if the only hits are the type declaration and the validator's allowlist, it's dead. Confirmed live: `onConfigLoaded`, `onStorageReady`, `onContentIndexReady`, `onRequest`, `onCollectionResolved`, `onBeforeRender`, `onMarkdownProcess`, `onMarkdownProcessed`, `onMediaDiscovered`, `onCacheHit`, `onCacheMiss`, `onCacheInvalidate`, `onApiRequest`, `onApiResponse`, `onRebuild`, `onThemeSwitch`, `onSearchRecordsCollect`, `onSearchEngineCreate`, `onPageCreate`, `onPageUpdate`, `onPageDelete`, `onWorkflowChange`.

---

## Admin routes

There is no `onAdminRoutes` hook, and `@dune/core` itself does not export `requirePermission`/`csrfCheck` — plugin authors sometimes assume these exist because plugin-admin's own internal admin routes use functions with those names. Attempting `import { requirePermission } from "@dune/core"` fails — the specifier doesn't resolve. They do exist as a public, importable API — from `@dune/plugin-admin/admin/guards`, not `@dune/core` — see the `mount()` section below.

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
import { withGuards } from "@dune/plugin-admin/admin/guards";

export default {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {},
  async mount({ app }: MountApi) {
    app.post(
      "/admin/api/my-plugin/action",
      withGuards({ permission: "config.update" }, async (fc) => {
        // csrfCheck() and requirePermission() have already run and passed —
        // withGuards() rejects the request before your handler is called
        // otherwise. Add `validatePath: "someParam"` too if the route takes
        // a path-shaped URL param.
        return Response.json({ ok: true });
      }),
    );
  },
} satisfies DunePlugin;
```

A route registered via `mount()` is **not** automatically authenticated the way `adminPages` is — you must wrap it in `withGuards()` (or call `csrfCheck()`/`requirePermission()` from the same module directly) yourself. Reimplementing the guard sequence by hand instead of using `withGuards()` is exactly what caused three real security regressions in Dune's own admin routes (the module's own doc comment names them) — the CSRF check's Origin/Sec-Fetch-Site/Referer fallback chain in particular is not trivial to get right, and `requirePermission()` checks the polizy-backed `authz` system first when configured, falling back to the role table only when it's not — a detail that's easy to miss if you reach for `AdminContext.auth.hasPermission()` directly instead. If your plugin only needs to *display* data or trigger something a human clicks through in the admin UI, prefer `adminPages` anyway — you get all of this for free, no `withGuards()` needed.

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

**`publicRoutes` and `adminPages` are wired up differently — `publicRoutes` is `@dune/core`-owned, `adminPages` is `@dune/plugin-admin`-owned.** `bootstrap()` collects every plugin's `publicRoutes` onto `BootstrapResult.pluginPublicRoutes`, and `createDuneApp()` itself registers them as live Fresh routes (`registerPluginPublicRoutes()`, `src/runtime/register-plugin-routes.ts`) — this works in every `createDuneApp()` context: `admin.enabled: false`, no `@dune/plugin-admin` installed at all, `dune mcp:serve`'s lightweight bootstrap, all of it. `adminPages` is different: core's `bootstrap()` doesn't even collect it, only `@dune/plugin-admin`'s `mountDuneAdmin()` reads it directly from `hooks.plugins()`, because registering it means enforcing each page's declared `permission` via the admin panel's own auth system — something `@dune/core` has no reason to depend on. So `adminPages` still needs `admin.enabled !== false` (the default) in the normal `dune serve`/`dune dev` path, or an explicit `mountDuneAdmin(app, ctx)` call in headless mode — skip both and `adminPages` entries go dark with no error, while `publicRoutes` keeps working regardless.

Headless-mode developers who call `mountDuneAdmin(app, ctx)` directly (never going through `createDuneApp()`) still get `publicRoutes` too — `mountDuneAdmin()` delegates to the same core `registerPluginPublicRoutes()` function rather than re-implementing it, and calling it twice for the same bootstrap (once from `createDuneApp()`, once from `mountDuneAdmin()` when both happen to run in the same process) is a safe no-op, not a double-registration.

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

**A `mount()`-registered mutation route is unauthenticated by default — wrap it in `withGuards()`.** `import { withGuards } from "@dune/plugin-admin/admin/guards"` (also exports `csrfCheck`/`requirePermission`/`validatePagePath` individually). Skipping this isn't a missing-import problem anymore, just an easy-to-forget step — `adminPages` (GET-only) still gets you auth/permission enforcement with zero extra code, if that's enough for your route.

**`adminPages` paths are relative to the admin prefix.** `path: "/my-plugin"` → `/admin/my-plugin`. Writing `path: "/admin/my-plugin"` double-prefixes to `/admin/admin/my-plugin`.

**There is no `ctx.db` on any hook, ever.** `HookContext` only has `event`, `data`, `config`, `storage`, `stopPropagation`, `setData`, and an optional `jobs`. If your plugin needs the data layer, import `@dune/core/db` directly — it's never injected, regardless of config.

**`mount()` runs once at startup, after the Fresh `App` is ready.** Register routes and middleware there; don't rely on it for per-request async work — that belongs in the route handlers themselves.

**Hook error handling is not uniform — check the caller before assuming.** `HookRegistry.fire()` itself (`src/hooks/registry.ts`) has no try/catch around handler calls. Whether a throwing hook is contained depends entirely on who calls `fire()`: the admin panel's page CRUD routes (`onPageCreate`/`onPageUpdate`/`onPageDelete`/`onWorkflowChange`) call it as `hooks.fire(...).catch(() => {})` — errors are silently swallowed, not even logged. Startup and engine-lifecycle hooks (`onConfigLoaded`, `onStorageReady`, `onContentIndexReady`, `onRebuild`, `onThemeSwitch`) are `await`ed directly with no catch — a throwing handler there propagates and can fail bootstrap or a rebuild. Don't assume either behavior; if a hook has a side effect that must succeed or must not silently vanish, handle its own errors explicitly and log them yourself.

**Pin JSR/npm plugin versions.** `src: jsr:@dune/blog` without a version pinned fails validation. Use `^major.minor.patch` at minimum.

**`setup()`'s returned Promise is fire-and-forget — the registry does not await it before hooks can fire.** `registerPlugin()` (`src/hooks/registry.ts`) calls `plugin.setup(api)` synchronously and, if it returns a Promise, only attaches a `.catch()` for error logging — it does not block registration or hook dispatch on it resolving. If your `setup()` needs to `await` something (a network call, a file read) before your plugin is actually ready, a hook can fire in that window and see whatever state `setup()` hadn't gotten around to initializing yet. Keep `setup()` synchronous when you can (as in the email example above — `createEmailClient`/`createEmailProvider` are both sync); if you genuinely need async initialization, the registry's own doc comment says to subscribe to `onContentIndexReady` instead of relying on `setup()` completing first.
