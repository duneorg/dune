# Skill: Dune Themes

Theme architecture — directory layout, templates, layouts, islands (client-side interactivity), components, static assets, and inheritance.

---

## Directory layout

```
themes/my-theme/
├── theme.yaml           — name, version, optional parent (inheritance)
├── templates/           — page templates (server-rendered, no JS sent to browser)
│   ├── default.tsx
│   └── post.tsx
├── components/          — server-side shared components (no JS sent to browser)
│   └── layout.tsx
├── islands/             — Preact components hydrated in the browser ✦
│   ├── NavToggle.tsx
│   └── SearchBox.tsx
└── static/              — copied as-is to the site root at build time
    └── styles.css
```

---

## Islands — client-side interactivity

**Dune fully supports Fresh-style islands.** Drop a `.tsx` Preact component into `themes/{name}/islands/` and import it from any template. No registration, no config — Dune + Fresh discover and bundle it automatically.

### Creating an island

```tsx
// themes/my-theme/islands/NavToggle.tsx
/** @jsxImportSource preact */
import { useState } from "preact/hooks";

export default function NavToggle({ links }: { links: { label: string; href: string }[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="nav-mobile">
      <button
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen(o => !o)}
      >
        {open ? "✕" : "☰"}
      </button>
      {open && (
        <ul>
          {links.map(({ label, href }) => (
            <li key={href}><a href={href}>{label}</a></li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### Using an island in a template

Import from the relative `../islands/` path. Fresh detects the import and wires hydration automatically:

```tsx
// themes/my-theme/templates/default.tsx
/** @jsxImportSource preact */
import NavToggle from "../islands/NavToggle.tsx";  // ← Fresh sees this, bundles + hydrates it

export default function DefaultTemplate({ page, site, children }: TemplateProps) {
  return (
    <html>
      <body>
        {/* Renders on server first, then hydrates in the browser */}
        <NavToggle links={[{ label: "Home", href: "/" }, { label: "Blog", href: "/blog" }]} />
        {/* children is a pre-rendered vnode, not an HTML string — no dangerouslySetInnerHTML */}
        <main>{children}</main>
      </body>
    </html>
  );
}
```

**`page.html` is never a bare string — it's an async method.** `Page.html` on the real `page` object is `() => Promise<string>`. There are two correct ways to get the rendered body, and `{ __html: page.html }` (no call, no await) is neither of them:
- **`children`** (the common case) — `content-handler.ts` already calls and awaits `page.html()` for you and hands the result down as a separate, pre-rendered top-level `children` prop (a Preact vnode, not a string). Render it directly: `<div>{children}</div>`. No `async`, no `dangerouslySetInnerHTML`.
- **`await page.html()`** directly, if you need the raw string — but then the template component itself must be declared `async function` (`src/themes/resolve-template.ts` specifically supports this: it detects an async top-level template component and awaits it before rendering). In that case: `<div dangerouslySetInnerHTML={{ __html: await page.html() }} />` is correct.

### How it works under the hood

`collectThemeIslands()` in `src/themes/loader.ts` scans `islands/` across the full theme inheritance chain at startup and registers every `.tsx` file with Fresh's builder. In `dune dev`, Fresh watches the directory and rebuilds the JS bundle on any change without a server restart.

### Props must be JSON-serialisable

Props cross the server/client boundary via serialisation into the page HTML. Strings, numbers, booleans, plain objects, and arrays are fine. Functions and class instances are not.

```tsx
<SearchBox placeholder="Search…" minChars={2} />         // ✅
<Counter onChange={(n) => console.log(n)} />              // ❌ function prop
```

### Islands in TSX content pages

TSX content pages can also import islands using relative paths. Dune scans imports at startup and auto-registers anything under an `islands/` directory:

```tsx
// content/demos/counter-demo.tsx
import NavToggle from "../../themes/my-theme/islands/NavToggle.tsx";
```

### deno.json import map

esbuild requires explicit subpath entries — a catch-all prefix entry alone is not sufficient for island bundling:

```json
{
  "imports": {
    "preact": "npm:preact@^10",
    "preact/hooks": "npm:preact@^10/hooks",
    "preact/jsx-runtime": "npm:preact@^10/jsx-runtime",
    "preact/jsx-dev-runtime": "npm:preact@^10/jsx-dev-runtime"
  }
}
```

---

## Templates

Templates live in `themes/{name}/templates/*.tsx`. They receive the fully rendered page and return the complete HTML document.

```tsx
// themes/my-theme/templates/post.tsx
/** @jsxImportSource preact */
import type { TemplateProps } from "@dune/core";
import Layout from "../components/layout.tsx";

export default function PostTemplate({ page, site, nav, children }: TemplateProps) {
  return (
    <Layout site={site} nav={nav}>
      <article>
        <h1>{page.frontmatter.title}</h1>
        <div data-dune-body>{children}</div>
      </article>
    </Layout>
  );
}
```

**Always put `data-dune-body` on the element that wraps the rendered markdown body** (`{children}`, not `page.html` — see the note above) — and only on that element. It marks the body region for inline editing (the `@dune/plugin-inline-edit` plugin); there is no auto-detection. Listing/landing templates that render cards or collections instead of a markdown body must NOT carry the attribute. This also applies when converting templates from other systems (Grav/Twig, Hugo, WordPress): place `data-dune-body` on the converted equivalent of `{{ page.content }}` / `.Content` / `the_content()`.

For typed markers, `@dune/core/ui/editable` provides server-only components that render exactly these attributes — `<EditableMarkdown sourcePath={page.sourcePath}>…</EditableMarkdown>` is identical to a hand-written `data-dune-body` wrapper, and `<EditableText field="title" sourcePath={…}>` marks individual frontmatter fields. They ship no JS and imply no editor; editor plugins consume the rendered markers.

Markers never reach anonymous visitors: the response pipeline scrubs all `data-dune-*` attributes from HTML served without a validated editing session, so `data-dune-source` paths stay private. Consequence for themes: never use `data-dune-*` attributes as CSS/JS hooks for public styling — they are absent from public responses (verify markers while logged in as an admin, not in an incognito window).

| Prop | Contents |
|------|----------|
| `page.frontmatter` | All YAML frontmatter fields |
| `children` | Pre-rendered content — a Preact vnode already wrapping the rendered HTML of the md/mdx body. **Not** `page.html` (that's an async method on `page`, not a usable string). |
| `page.route` | URL path, e.g. `/blog/hello-world` |
| `page.language` | Language code, e.g. `"en"` |
| `site` | Values from `site.yaml` |
| `nav` | Top-level navigation items |

A content page selects its template via `template:` frontmatter. `template: post` → `templates/post.tsx`. Falls back to `templates/default.tsx` when not specified.

**Templates are server-only.** No JS from a template is sent to the browser. Only code in `islands/` hydrates on the client.

---

## Layout components

Layout components in `components/` are shared server-side wrappers — `<html>`, `<head>`, site nav, footer. They are not templates; templates import them.

```tsx
// themes/my-theme/components/layout.tsx
/** @jsxImportSource preact */
import NavToggle from "../islands/NavToggle.tsx";

const NAV_LINKS = [{ label: "Home", href: "/" }, { label: "Blog", href: "/blog" }];

export default function Layout({ children, site }: any) {
  return (
    <html lang="en">
      <head>
        <title>{site?.title}</title>
      </head>
      <body>
        <header>
          <a href="/"><strong>{site?.title}</strong></a>
          <NavToggle links={NAV_LINKS} />
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

---

## Theme inheritance

```yaml
# themes/child-theme/theme.yaml
name: child-theme
parent: parent-theme
```

Templates, components, and islands are resolved through the chain: child overrides parent. Islands from all themes in the chain are bundled together — a child template can import a parent island directly.

Keep island filenames unique across the chain to avoid module ID collisions.

### Package themes

Register JSR/npm packages in `config/site.yaml`:

```yaml
themes:
  - name: paper
    src: jsr:@dune/theme-paper@1.0.0

theme:
  name: my-brand
  parent: paper    # themes/my-brand/ overrides the package
```

Install: `dune theme:install jsr:@dune/theme-paper@1.0.0`

---

## Static assets

Files in `themes/{name}/static/` are served at `/themes/{name}/static/{path}` — **not** copied to the site root. A file at `themes/my-theme/static/styles.css` is served at `/themes/my-theme/static/styles.css`, not `/styles.css`. This holds for both `dune serve`/`dune dev` (`src/runtime/register-static.ts`'s `/themes/*` route) and `dune build --static` (the SSG builder copies theme static files into `{outDir}/themes/{name}/static/` in the output, same URL shape).

---

## Gotchas

**Templates vs islands — the key distinction.** Templates run on the server only. Islands are the only code that runs in the browser. If you need client-side interactivity (event handlers, state, effects), it must be in an island — not in a template or component.

**Import path must be relative for island auto-discovery.** `import NavToggle from "../islands/NavToggle.tsx"` is discovered. `import NavToggle from "my-theme/islands/NavToggle.tsx"` is not.

**`template:` in frontmatter must match an actual file.** `template: post` requires `themes/<active>/templates/post.tsx`. `dune validate` catches this before the server starts.

**Islands need explicit preact subpath imports in deno.json.** The `preact/` prefix catch-all is not enough for esbuild. Add `preact/hooks`, `preact/jsx-runtime`, and `preact/jsx-dev-runtime` explicitly (see above).

**The `islands/` directory is optional.** If no theme in the active chain has one, no JS bundle is generated — no boot script, no client JS at all. This is intentional: zero JS by default.

**`page.html` is a `Promise<string>`-returning method, not a string.** Use `children` (sync, the common case) or `await page.html()` inside an `async function` template — see the Templates section above. This is the single most common mistake when writing a template from scratch or porting one from another system.

**Only the *top-level* template component may be `async`.** `resolveTemplateVNode` awaits the template component itself if it's async, but nested components (a `Layout`, a card component, etc.) are rendered synchronously by Preact's renderer — which, per `resolve-template.ts`'s own comment, silently renders a Promise-returning component as *nothing* (not an error, not `[object Promise]`, just empty output). If a nested component needs `await page.html()`, resolve it in the top-level async template and pass the string/vnode down as a prop instead.

**Theme `static/` files are not copied to the site root.** They're served at `/themes/{name}/static/{path}`, in both dev and static-build output. Reference them from templates/CSS with that full path, not a root-relative one.
