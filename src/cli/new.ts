/**
 * dune new [dir] — Scaffold a new Dune site.
 */

const SITE_YAML = `title: My Dune Site
description: A flat-file CMS powered by Deno Fresh
url: http://localhost:3000
author:
  name: ""
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
    "@dune/cms": "jsr:@dune/cms@^0.1"
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

export async function newCommand(dir: string) {
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

async function mkdirp(path: string) {
  await Deno.mkdir(path, { recursive: true });
}
