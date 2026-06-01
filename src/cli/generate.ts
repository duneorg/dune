/**
 * dune generate:* — Scaffold generators for plugins, routes, forms, themes, and schemas.
 *
 * Usage:
 *   dune generate:plugin <name>    Create a plugin scaffold in plugins/{name}/index.ts
 *   dune generate:route <name>     Create a content page at content/{name}.md
 *   dune generate:form <name>      Create a blueprint schema at schemas/{name}.yaml
 *   dune generate:theme <name>     Create a theme scaffold at themes/{name}/
 *   dune generate:schema <name>    Create a Flex Object schema at flex-objects/{name}.yaml
 *   dune generate --list           List all available generators
 */

import { join, resolve } from "@std/path";

export interface GenerateOptions {
  force?: boolean;
  permission?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Slugify a name: lowercase, spaces/underscores to hyphens, strip leading/trailing hyphens. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "");
}

/** Derive a title from a slug: hyphens to spaces, title-case each word. */
function titleFromSlug(slug: string): string {
  return slug
    .split(/[-/]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Check if a file exists.  Returns true if it does, false if not.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard against file collisions.  If the file exists and --force is not set,
 * print an error and exit 1.  If --force is set, proceed (caller will overwrite).
 */
async function guardCollision(
  filePath: string,
  root: string,
  force: boolean,
): Promise<void> {
  if (await fileExists(filePath)) {
    if (!force) {
      const rel = filePath.startsWith(root + "/") ? filePath.slice(root.length + 1) : filePath;
      console.error(`  ✗ File already exists: ${rel}`);
      console.error(`    Use --force to overwrite.`);
      Deno.exit(1);
    }
  }
}

// ── Generators ───────────────────────────────────────────────────────────────

/**
 * generate:plugin <name>
 * Creates plugins/{name}/index.ts with a minimal valid DunePlugin.
 */
export async function generatePlugin(
  root: string,
  name: string,
  opts: GenerateOptions = {},
): Promise<void> {
  const slug = slugify(name);
  if (!slug) {
    console.error("  ✗ Invalid plugin name.");
    Deno.exit(1);
  }

  const outPath = join(root, "plugins", slug, "index.ts");
  await guardCollision(outPath, root, opts.force ?? false);

  const content = `import type { DunePlugin } from "@dune/core/plugins";

const plugin: DunePlugin = {
  name: "${slug}",
  version: "0.1.0",
  setup(hooks) {
    // Register hooks here
    // hooks.on("onRebuild", async () => { ... });
  },
};

export default plugin;
`;

  await Deno.mkdir(join(root, "plugins", slug), { recursive: true });
  await Deno.writeTextFile(outPath, content);

  const rel = `plugins/${slug}/index.ts`;
  console.log(`🏜️  Dune — generate:plugin\n`);
  console.log(`  ✅ ${rel}`);
  console.log(`\n  Add to config/site.yaml:\n    plugins:\n      - src: "./${rel}"`);
}

/**
 * generate:route <name>
 * Creates content/{name}.md with starter frontmatter.
 * Name may include path separators, e.g. "blog/archive".
 */
export async function generateRoute(
  root: string,
  name: string,
  opts: GenerateOptions = {},
): Promise<void> {
  const slug = name
    .split("/")
    .map((seg) => slugify(seg))
    .filter(Boolean)
    .join("/");

  if (!slug) {
    console.error("  ✗ Invalid route name.");
    Deno.exit(1);
  }

  const lastSegment = slug.split("/").at(-1)!;
  const title = titleFromSlug(lastSegment);
  const outPath = join(root, "content", `${slug}.md`);

  await guardCollision(outPath, root, opts.force ?? false);

  const content = `---
title: ${title}
template: default
published: false
---

# ${title}

Content goes here.
`;

  await Deno.mkdir(join(root, "content", ...slug.split("/").slice(0, -1)), { recursive: true });
  await Deno.writeTextFile(outPath, content);

  const rel = `content/${slug}.md`;
  console.log(`🏜️  Dune — generate:route\n`);
  console.log(`  ✅ ${rel}`);
  console.log(`     Route: /${slug}`);
  console.log(`     Title: ${title}`);
}

/**
 * generate:form <name>
 * Creates schemas/{name}.yaml — a blueprint YAML with example fields.
 */
export async function generateForm(
  root: string,
  name: string,
  opts: GenerateOptions = {},
): Promise<void> {
  const slug = slugify(name);
  if (!slug) {
    console.error("  ✗ Invalid form name.");
    Deno.exit(1);
  }

  const title = titleFromSlug(slug);
  const outPath = join(root, "schemas", `${slug}.yaml`);

  await guardCollision(outPath, root, opts.force ?? false);

  const content = `title: ${title}
fields:
  name:
    type: text
    label: Name
    required: true
  email:
    type: email
    label: Email
    required: true
  message:
    type: textarea
    label: Message
`;

  await Deno.mkdir(join(root, "schemas"), { recursive: true });
  await Deno.writeTextFile(outPath, content);

  const rel = `schemas/${slug}.yaml`;
  console.log(`🏜️  Dune — generate:form\n`);
  console.log(`  ✅ ${rel}`);
}

/**
 * generate:theme <name>
 * Creates a minimal theme scaffold:
 *   themes/{name}/theme.yaml
 *   themes/{name}/templates/default.tsx
 *   themes/{name}/assets/style.css
 */
export async function generateTheme(
  root: string,
  name: string,
  opts: GenerateOptions = {},
): Promise<void> {
  const slug = slugify(name);
  if (!slug) {
    console.error("  ✗ Invalid theme name.");
    Deno.exit(1);
  }

  const themeYamlPath = join(root, "themes", slug, "theme.yaml");
  const templatePath = join(root, "themes", slug, "templates", "default.tsx");
  const cssPath = join(root, "themes", slug, "assets", "style.css");

  // Check all files for collision before writing any.
  for (const p of [themeYamlPath, templatePath, cssPath]) {
    await guardCollision(p, root, opts.force ?? false);
  }

  const themeYaml = `name: "${slug}"
version: "0.1.0"
`;

  const templateTsx = `import type { PageProps } from "@dune/core";

export default function DefaultTemplate({ page }: PageProps) {
  return (
    <html>
      <head>
        <meta charset="utf-8" />
        <title>{page.title}</title>
        <link rel="stylesheet" href="/assets/style.css" />
      </head>
      <body>
        <main dangerouslySetInnerHTML={{ __html: page.html }} />
      </body>
    </html>
  );
}
`;

  const css = `/* ${slug} theme styles */
`;

  await Deno.mkdir(join(root, "themes", slug, "templates"), { recursive: true });
  await Deno.mkdir(join(root, "themes", slug, "assets"), { recursive: true });
  await Deno.writeTextFile(themeYamlPath, themeYaml);
  await Deno.writeTextFile(templatePath, templateTsx);
  await Deno.writeTextFile(cssPath, css);

  console.log(`🏜️  Dune — generate:theme\n`);
  console.log(`  ✅ themes/${slug}/theme.yaml`);
  console.log(`  ✅ themes/${slug}/templates/default.tsx`);
  console.log(`  ✅ themes/${slug}/assets/style.css`);
  console.log(`\n  Activate in config/site.yaml:\n    theme: ${slug}`);
}

/**
 * generate:admin-route <name>
 * Creates src/admin/routes/api/{name}.ts with a standard AdminState handler,
 * requirePermission guard, and json() helper already imported.
 *
 * Options:
 *   --permission <perm>   Pre-wire the requirePermission() guard (default: "pages.read")
 */
export async function generateAdminRoute(
  root: string,
  name: string,
  opts: GenerateOptions & { permission?: string } = {},
): Promise<void> {
  const slug = name
    .split("/")
    .map((seg) => slugify(seg))
    .filter(Boolean)
    .join("/");

  if (!slug) {
    console.error("  ✗ Invalid route name.");
    Deno.exit(1);
  }

  const permission = opts.permission ?? "pages.read";
  const outPath = join(root, "src", "admin", "routes", "api", `${slug}.ts`);

  await guardCollision(outPath, root, opts.force ?? false);

  const content = `/** GET /admin/api/${slug} */

import type { AdminState } from "../../types.ts";
import { requirePermission, json } from "./_utils.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = await requirePermission(ctx, "${permission}");
    if (denied) return denied;

    // TODO: implement
    return json({ ok: true });
  },
};
`;

  await Deno.mkdir(join(root, "src", "admin", "routes", "api", ...slug.split("/").slice(0, -1)), {
    recursive: true,
  });
  await Deno.writeTextFile(outPath, content);

  const rel = `src/admin/routes/api/${slug}.ts`;
  console.log(`🏜️  Dune — generate:admin-route\n`);
  console.log(`  ✅ ${rel}`);
  console.log(`     Route:      GET /admin/api/${slug}`);
  console.log(`     Permission: ${permission}`);
  console.log(`\n  Adjust the handler methods and permission as needed.`);
}

/**
 * generate:schema <name>
 * Creates flex-objects/{name}.yaml with a Flex Object schema.
 */
export async function generateSchema(
  root: string,
  name: string,
  opts: GenerateOptions = {},
): Promise<void> {
  const slug = slugify(name);
  if (!slug) {
    console.error("  ✗ Invalid schema name.");
    Deno.exit(1);
  }

  const title = titleFromSlug(slug);
  const outPath = join(root, "flex-objects", `${slug}.yaml`);

  await guardCollision(outPath, root, opts.force ?? false);

  const content = `title: ${title}
icon: 📦
description: ${title} records
fields:
  title:
    type: text
    label: Title
    required: true
  body:
    type: textarea
    label: Body
`;

  await Deno.mkdir(join(root, "flex-objects"), { recursive: true });
  await Deno.writeTextFile(outPath, content);

  const rel = `flex-objects/${slug}.yaml`;
  console.log(`🏜️  Dune — generate:schema\n`);
  console.log(`  ✅ ${rel}`);
}

// ── Generator registry ────────────────────────────────────────────────────────

const GENERATORS: Record<string, string> = {
  "generate:plugin": "Scaffold a plugin in plugins/{name}/index.ts",
  "generate:route": "Create a content page at content/{name}.md",
  "generate:form": "Create a blueprint schema at schemas/{name}.yaml",
  "generate:theme": "Scaffold a theme at themes/{name}/",
  "generate:schema": "Create a Flex Object schema at flex-objects/{name}.yaml",
  "generate:admin-route": "Scaffold an admin API route in src/admin/routes/api/{name}.ts",
};

export function generateList(): void {
  console.log(`🏜️  Dune — generate --list\n`);
  console.log(`Available generators:\n`);
  for (const [cmd, desc] of Object.entries(GENERATORS)) {
    console.log(`  ${cmd.padEnd(24)} ${desc}`);
  }
  console.log(`\nUsage: dune <generator> <name> [--force]`);
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export async function generateCommand(
  root: string,
  subcommand: string,
  name: string,
  opts: GenerateOptions = {},
): Promise<void> {
  root = resolve(root);

  if (subcommand === "--list" || subcommand === "list") {
    generateList();
    return;
  }

  if (!name) {
    console.error(`  ✗ Usage: dune ${subcommand} <name>`);
    Deno.exit(1);
  }

  switch (subcommand) {
    case "generate:plugin":
      await generatePlugin(root, name, opts);
      break;

    case "generate:route":
      await generateRoute(root, name, opts);
      break;

    case "generate:form":
      await generateForm(root, name, opts);
      break;

    case "generate:theme":
      await generateTheme(root, name, opts);
      break;

    case "generate:schema":
      await generateSchema(root, name, opts);
      break;

    case "generate:admin-route":
      await generateAdminRoute(root, name, opts);
      break;

    default:
      console.error(`  ✗ Unknown generator: ${subcommand}`);
      console.error(`    Run: dune generate --list`);
      Deno.exit(1);
  }
}
