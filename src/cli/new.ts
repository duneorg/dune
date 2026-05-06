/**
 * dune new [dir] — Scaffold a new Dune site.
 */

const SITE_YAML = `title: My Dune Site
description: A flat-file CMS powered by Deno Fresh
url: http://localhost:3000
author:
  name: ""
# Home page: which folder serves as "/". Autodetected if omitted
# (uses the first ordered folder, e.g. 01.home/).
# home: home
taxonomies:
  - category
  - tag
`;

const SYSTEM_YAML = `content:
  dir: content
cache:
  enabled: true
  driver: memory
  lifetime: 3600
  check: file
debug: false
`;

const THEME_YAML = `name: starter
description: Default starter theme for Dune
version: "0.1.0"
`;

const LAYOUT_TSX = `/** @jsxImportSource preact */
import { h } from "preact";

export default function Layout({ children, site }: any) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{site?.title ?? "Dune Site"}</title>
        <style>{\`
          body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #333; }
          h1 { margin-bottom: 0.5rem; }
          pre { background: #f5f5f5; padding: 1rem; border-radius: 4px; overflow-x: auto; }
          code { font-family: "SF Mono", Monaco, monospace; font-size: 0.9em; }
          a { color: #0066cc; }
          img { max-width: 100%; }
          nav a { margin-right: 1rem; }
        \`}</style>
      </head>
      <body>
        <nav>
          <a href="/"><strong>{site?.title ?? "Home"}</strong></a>
          <a href="/blog">Blog</a>
        </nav>
        <main>{children}</main>
        <footer style={{ marginTop: "3rem", borderTop: "1px solid #eee", paddingTop: "1rem", color: "#999" }}>
          <p>Powered by Dune</p>
        </footer>
      </body>
    </html>
  );
}
`;

const DEFAULT_TEMPLATE = `/** @jsxImportSource preact */
import { h } from "preact";
import Layout from "../components/layout.tsx";

export default function DefaultTemplate({ page, site, children }: any) {
  return (
    <Layout site={site}>
      <article>
        <h1>{page?.frontmatter?.title}</h1>
        {page?.frontmatter?.date && <time style={{ color: "#999" }}>{page.frontmatter.date}</time>}
        <div>{children}</div>
      </article>
    </Layout>
  );
}
`;

const HOME_MD = `---
title: Welcome to Dune
template: default
published: true
taxonomy:
  category: [general]
---

# Welcome to Your Dune Site

This is your new flat-file CMS site. Content is files — no database required.

## Getting Started

- Edit this file at \`content/01.home/default.md\`
- Add new pages by creating folders in \`content/\`
- Customize the theme in \`themes/starter/\`

## Quick Links

- **Folder = page** — Your directory structure IS your site structure
- **Frontmatter = config** — YAML metadata controls everything
- **Markdown for prose** — Write in Markdown, render with themes
`;

const BLOG_MD = `---
title: Blog
template: default
published: true
collection:
  items:
    "@self.children": true
  order:
    by: date
    dir: desc
taxonomy:
  category: [blog]
---

# Blog

Check back soon for posts.
`;

const FIRST_POST = `---
title: Hello World
date: "${new Date().toISOString().split("T")[0]}"
template: default
published: true
taxonomy:
  category: [blog]
  tag: [welcome, dune]
---

# Hello World

This is your first blog post. Edit it at \`content/02.blog/01.hello-world/post.md\`.

## What's Next

1. Create more posts in \`content/02.blog/\`
2. Customize your theme in \`themes/starter/\`
3. Add taxonomy pages for categories and tags
`;

const DENO_JSON = `{
  "imports": {
    "preact": "npm:preact@^10",
    "preact/": "npm:preact@^10/",
    "preact-render-to-string": "npm:preact-render-to-string@^6",
    "@dune/core": "jsr:@dune/core@^0.6"
  },
  "tasks": {
    "dev": "deno run -A --import-map=deno.json main.ts dev",
    "build": "deno run -A --import-map=deno.json main.ts build",
    "serve": "deno run -A --import-map=deno.json main.ts serve"
  },
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
`;

// ── Headless scaffold templates ───────────────────────────────────────────────

const HEADLESS_SITE_YAML = `title: My Headless Site
description: A Dune-powered Fresh site in headless mode
url: http://localhost:3000
author:
  name: ""

taxonomies:
  - tag
  - category
`;

const HEADLESS_SYSTEM_YAML = `content:
  dir: content
debug: false
`;

const HEADLESS_DENO_JSON = `{
  "name": "my-headless-site",
  "version": "0.1.0",
  "tasks": {
    "dev": "deno run -A --watch=main.ts main.ts",
    "start": "deno run -A main.ts"
  },
  "imports": {
    "fresh": "jsr:@fresh/core@^2",
    "@dune/core": "jsr:@dune/core",
    "preact": "npm:preact@^10",
    "preact/": "npm:preact@^10/",
    "@preact/signals": "npm:@preact/signals@^1",
    "@preact/signals-core": "npm:@preact/signals-core@^1"
  },
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  }
}
`;

const HEADLESS_MAIN_TS = `/**
 * Headless Dune site — Fresh developer owns all routes.
 *
 * Dune provides: content management, admin panel, CMS API.
 * You provide: routes, layout, islands, design system.
 */
import { App, staticFiles } from "fresh";
import { Builder } from "jsr:@fresh/core@^2/dev";
import { bootstrap } from "@dune/core";
import { mountDuneAdmin, getDuneAdminIslands } from "@dune/core/admin";

// 1. Bootstrap Dune (content index, admin, search, …)
const ctx = await bootstrap("./");
const app = new App();

// 2. Static files from /_fresh/js/* (island bundles) and /static/
app.use(staticFiles());

// 3. Dune admin panel (/admin/*) + public API (/api/contact, /api/forms/*)
await mountDuneAdmin(app, ctx);

// 4. Your own routes — Fresh discovers them from routes/ automatically
app.fsRoutes("./routes");

// 5. Build island bundles (admin islands + your own islands in islands/)
const builder = new Builder({
  root: "./",
  islandDir: "./islands",
  islandSpecifiers: getDuneAdminIslands(),
});
const applySnapshot = await builder.build({ mode: "production", snapshot: "memory" });
applySnapshot(app);

// 6. Start server
Deno.serve({ port: 3000, handler: app.handler() });
`;

const HEADLESS_LAYOUT_TSX = `/** @jsxImportSource preact */

export default function Layout({ children }: { children: unknown }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>My Site</title>
      </head>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
`;

const HEADLESS_INDEX_TSX = `/** @jsxImportSource preact */
import { getContent } from "@dune/core/content";

// Static render — fetched at request time
export default function Home() {
  const pages = getContent().pages({ limit: 5, orderBy: "date", orderDir: "desc" });
  return (
    <div>
      <h1>Welcome</h1>
      <ul>
        {pages.map((p) => (
          <li key={p.route}>
            <a href={p.route}>{p.title}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
`;

const HEADLESS_BLOG_INDEX_TSX = `/** @jsxImportSource preact */
import type { FreshContext, PageProps } from "fresh";
import { getContent } from "@dune/core/content";
import type { PageIndex } from "@dune/core";

export async function handler(_req: Request, ctx: FreshContext) {
  const posts = getContent().pages({
    orderBy: "date",
    orderDir: "desc",
  });
  return ctx.render(posts);
}

export default function BlogIndex({ data }: PageProps<PageIndex[]>) {
  return (
    <div>
      <h1>Blog</h1>
      <ul>
        {data.map((post) => (
          <li key={post.route}>
            <a href={post.route}>{post.title}</a>
            {post.date && <time> — {post.date}</time>}
          </li>
        ))}
      </ul>
    </div>
  );
}
`;

const HEADLESS_BLOG_SLUG_TSX = `/** @jsxImportSource preact */
import type { FreshContext, PageProps } from "fresh";
import { getContent, type ResolvedPage } from "@dune/core/content";

export async function handler(req: Request, ctx: FreshContext) {
  const post = await getContent().page(\`/blog/\${ctx.params.slug}\`);
  if (!post) return ctx.next();
  return ctx.render(post);
}

export default function BlogPost({ data }: PageProps<ResolvedPage>) {
  return (
    <article>
      <h1>{data.title}</h1>
      {data.date && <time>{data.date}</time>}
      <div dangerouslySetInnerHTML={{ __html: data.html }} />
    </article>
  );
}
`;

const HEADLESS_FIRST_POST = `---
title: Hello World
date: ${new Date().toISOString().split("T")[0]}
tags:
  - welcome
---

Welcome to your headless Dune site.

Dune manages this content. Your **Fresh routes** control how it renders.
`;

export async function newCommand(dir: string, options: { headless?: boolean } = {}) {
  if (options.headless) {
    return _newHeadlessCommand(dir);
  }
  console.log(`🏜️  Dune — creating new site in "${dir}"...\n`);

  const start = performance.now();

  // Create directory structure
  await mkdirp(dir);
  await mkdirp(`${dir}/config`);
  await mkdirp(`${dir}/content/01.home`);
  await mkdirp(`${dir}/content/02.blog/01.hello-world`);
  await mkdirp(`${dir}/themes/starter/templates`);
  await mkdirp(`${dir}/themes/starter/components`);

  // Write files
  await Deno.writeTextFile(`${dir}/config/site.yaml`, SITE_YAML);
  await Deno.writeTextFile(`${dir}/config/system.yaml`, SYSTEM_YAML);
  await Deno.writeTextFile(`${dir}/themes/starter/theme.yaml`, THEME_YAML);
  await Deno.writeTextFile(`${dir}/themes/starter/components/layout.tsx`, LAYOUT_TSX);
  await Deno.writeTextFile(`${dir}/themes/starter/templates/default.tsx`, DEFAULT_TEMPLATE);
  await Deno.writeTextFile(`${dir}/content/01.home/default.md`, HOME_MD);
  await Deno.writeTextFile(`${dir}/content/02.blog/blog.md`, BLOG_MD);
  await Deno.writeTextFile(`${dir}/content/02.blog/01.hello-world/post.md`, FIRST_POST);
  await Deno.writeTextFile(`${dir}/deno.json`, DENO_JSON);

  const elapsed = (performance.now() - start).toFixed(0);

  console.log(`  ✅ Site created in ${elapsed}ms`);
  console.log(`\n  Created:`);
  console.log(`    config/site.yaml`);
  console.log(`    config/system.yaml`);
  console.log(`    content/01.home/default.md`);
  console.log(`    content/02.blog/blog.md`);
  console.log(`    content/02.blog/01.hello-world/post.md`);
  console.log(`    themes/starter/`);
  console.log(`    deno.json`);
  console.log(`\n  Next steps:`);
  console.log(`    cd ${dir}`);
  console.log(`    deno task dev`);
}

async function _newHeadlessCommand(dir: string) {
  console.log(`🏜️  Dune — creating headless site in "${dir}"...\n`);
  const start = performance.now();

  // Directory structure
  await mkdirp(dir);
  await mkdirp(`${dir}/config`);
  await mkdirp(`${dir}/content/01.blog/01.hello-world`);
  await mkdirp(`${dir}/routes/blog`);
  await mkdirp(`${dir}/islands`);
  await mkdirp(`${dir}/static`);

  // Config
  await Deno.writeTextFile(`${dir}/config/site.yaml`, HEADLESS_SITE_YAML);
  await Deno.writeTextFile(`${dir}/config/system.yaml`, HEADLESS_SYSTEM_YAML);

  // Content
  await Deno.writeTextFile(
    `${dir}/content/01.blog/01.hello-world/default.md`,
    HEADLESS_FIRST_POST,
  );

  // Routes
  await Deno.writeTextFile(`${dir}/routes/_layout.tsx`, HEADLESS_LAYOUT_TSX);
  await Deno.writeTextFile(`${dir}/routes/index.tsx`, HEADLESS_INDEX_TSX);
  await Deno.writeTextFile(`${dir}/routes/blog/index.tsx`, HEADLESS_BLOG_INDEX_TSX);
  await Deno.writeTextFile(`${dir}/routes/blog/[slug].tsx`, HEADLESS_BLOG_SLUG_TSX);

  // Project files
  await Deno.writeTextFile(`${dir}/deno.json`, HEADLESS_DENO_JSON);
  await Deno.writeTextFile(`${dir}/main.ts`, HEADLESS_MAIN_TS);

  // Placeholder for developer's own islands
  await Deno.writeTextFile(`${dir}/islands/.gitkeep`, "");

  const elapsed = (performance.now() - start).toFixed(0);

  console.log(`  ✅ Headless site created in ${elapsed}ms`);
  console.log(`\n  Created:`);
  console.log(`    config/site.yaml`);
  console.log(`    content/01.blog/01.hello-world/default.md`);
  console.log(`    routes/_layout.tsx`);
  console.log(`    routes/index.tsx`);
  console.log(`    routes/blog/index.tsx`);
  console.log(`    routes/blog/[slug].tsx`);
  console.log(`    main.ts`);
  console.log(`    deno.json`);
  console.log(`\n  Architecture:`);
  console.log(`    Dune manages:  content/, admin panel, public API`);
  console.log(`    You own:       routes/, islands/, static/`);
  console.log(`\n  Next steps:`);
  console.log(`    cd ${dir}`);
  console.log(`    deno task dev`);
  console.log(`\n  Admin panel: http://localhost:3000/admin\n`);
}

async function mkdirp(path: string) {
  await Deno.mkdir(path, { recursive: true });
}
