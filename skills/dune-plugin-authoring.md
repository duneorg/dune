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

Dune does not scan `plugins/` automatically — plugins must be registered (see below). Do not place plugin files anywhere else in the project.

---

## Registration

```yaml
# site.yaml
plugins:
  - src: plugins/my-plugin/mod.ts      # local plugin
  - spec: jsr:@dune/blog@^1.2.0        # JSR plugin — pin the major version
  - spec: npm:dune-comments@^2.0.0     # npm plugin
```

Local plugins use `src:`. Remote plugins use `spec:` with a pinned version. Unpinned plugin specs fail `dune validate`.

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

Every hook receives `ctx` as its first argument:

```ts
interface PluginContext {
  content: ContentAPI;     // query the content index
  email: EmailAPI;         // send transactional email
  db: DbAPI;               // query app data (requires db-schema-layer)
  config: SiteConfig;      // read site.yaml values
  logger: Logger;          // structured logging
}
```

---

## Common hook patterns

### React to content changes

```ts
hooks: {
  onContentLoad: async (ctx) => {
    // fires after the content index is built or rebuilt
    const posts = await ctx.content.find({ type: "post" });
    ctx.logger.info("plugin.content_loaded", { postCount: posts.length });
  },
}
```

### Cascade delete when a page is removed

```ts
hooks: {
  onPageDelete: async (ctx, page) => {
    await ctx.db.comments.delete({ where: { pageRoute: page.route } });
    await ctx.db.reactions.delete({ where: { pageRoute: page.route } });
  },
}
```

### Send email on a content event

```ts
hooks: {
  onPagePublish: async (ctx, page) => {
    if (page.frontmatter.notifySubscribers) {
      await ctx.email.send({
        to: "list@example.com",
        subject: `New post: ${page.title}`,
        template: "new-post",
        data: { title: page.title, route: page.route },
      });
    }
  },
}
```

### Modify page data before render

```ts
hooks: {
  onPageRender: async (ctx, page) => {
    // augment page.data — available in the template as additional props
    page.data.relatedPosts = await ctx.content.find({
      type: "post",
      taxonomy: { category: page.frontmatter.category },
      limit: 3,
    });
  },
}
```

---

## Admin routes

**All admin routes require security guards. Omitting them is a HIGH severity vulnerability.**

### GET route (read-only)

```ts
// plugins/my-plugin/mod.ts
import type { DunePlugin, FreshContext } from "@dune/core";
import { requirePermission } from "@dune/core";

async function listHandler(req: Request, ctx: FreshContext) {
  // handler logic
  return Response.json({ items: [] });
}

export default {
  name: "my-plugin",
  version: "1.0.0",
  hooks: {
    onAdminRoutes: (router) => {
      router.get(
        "/admin/my-plugin",
        requirePermission("pages.view"),   // ← required
        listHandler,
      );
    },
  },
} satisfies DunePlugin;
```

### POST route (mutation)

```ts
onAdminRoutes: (router) => {
  router.post(
    "/admin/api/my-plugin/action",
    requirePermission("pages.update"),   // ← required
    csrfCheck,                           // ← required on all mutations
    actionHandler,
  );
},
```

```ts
import { requirePermission, csrfCheck } from "@dune/core";
```

**Both `requirePermission` and `csrfCheck` are required on every mutation route.** `requirePermission` validates the admin session and role; `csrfCheck` prevents cross-site request forgery. Missing either is a security bug.

### Permission reference

| Action | Permission string |
|--------|-----------------|
| View any admin page | `"pages.view"` |
| Create / update pages | `"pages.update"` |
| Delete pages | `"pages.delete"` |
| Manage users | `"users.manage"` |
| Upload media | `"media.upload"` |
| Manage plugins | `"plugins.manage"` |

Use the most restrictive permission that still allows the action.

---

## Admin UI (TSX)

Admin route handlers return TSX for full-page views. Use the admin layout component:

```tsx
// plugins/my-plugin/admin.ts
import { AdminLayout } from "@dune/core/admin";
import type { FreshContext } from "@dune/core";

export async function listHandler(_req: Request, ctx: FreshContext) {
  const items = await ctx.state.db.myItems.find({});
  return ctx.render(
    <AdminLayout title="My Plugin" ctx={ctx}>
      <ul>{items.map(i => <li key={i.id}>{i.name}</li>)}</ul>
    </AdminLayout>
  );
}
```

---

## Testing a plugin

Use the plugin integration harness:

```ts
import { createTestHarness } from "@dune/testing";
import myPlugin from "./plugins/my-plugin/mod.ts";

const harness = await createTestHarness({
  content: {
    "01.home/default.md": "---\ntitle: Home\n---\nHello",
  },
  plugins: [myPlugin],
});

const page = await harness.render("/home");
assertEquals(page.html.includes("Hello"), true);

await harness.dispose();
```

---

## Gotchas

**Wrong file location.** Plugin files must be in `plugins/`. Placing them in `src/`, `routes/`, or the project root means they won't be found by `dune validate` and the plugin spec won't resolve correctly.

**Forgetting `csrfCheck` on mutations.** Every `POST`, `PUT`, `PATCH`, `DELETE` admin route needs `csrfCheck`. GET routes do not. If in doubt, add it — it's a no-op on safe methods.

**`requirePermission` does not replace `csrfCheck`.** They guard different things. Use both on every mutation route.

**Hook context `db` requires db-schema-layer.** `ctx.db` is only available if `db-schema-layer` is configured. If your plugin uses `ctx.db` and the site has no DB configured, it throws at runtime. Check `ctx.config.db?.enabled` if your plugin needs to be db-optional.

**`onAdminRoutes` fires before the server starts.** Do not perform async operations (DB queries, file reads) inside `onAdminRoutes` itself — only register routes. Async work belongs in the route handlers.

**Hook errors do not crash the server.** An unhandled error in a hook is logged and skipped. If your hook has a side effect that must succeed (e.g., sending a confirmation email), handle errors explicitly and log them — don't rely on the error propagating to the user.

**Pin JSR/npm plugin versions.** `spec: jsr:@dune/blog` without a version pinned fails validation. Use `^major.minor.patch` at minimum.
