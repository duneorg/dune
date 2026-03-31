/**
 * dune migrate:* — Import content from other CMS platforms.
 *
 * Commands:
 *   dune migrate:from-grav <src>       — Import a Grav site
 *   dune migrate:from-wordpress <src>  — Import a WordPress WXR export
 *   dune migrate:from-markdown <src>   — Import a flat markdown folder
 *   dune migrate:from-hugo <src>       — Import a Hugo site
 *
 * All commands write into the Dune site's content directory (configurable
 * with --out) and report a summary of what was imported.
 */

import { join, basename, extname, dirname } from "@std/path";
import { parse as parseYaml, stringify as stringifyYaml } from "@std/yaml";
import { ensureDir, exists } from "@std/fs";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

interface MigrateOptions {
  /** Target content directory (defaults to <root>/content) */
  out?: string;
  /** Print what would happen without writing files */
  dryRun?: boolean;
  /** Extra logging */
  verbose?: boolean;
}

interface MigrateResult {
  imported: number;
  skipped: number;
  errors: string[];
}

function log(msg: string) { console.log(msg); }
function info(msg: string) { console.log(`  ${msg}`); }
function warn(msg: string) { console.warn(`  ⚠️  ${msg}`); }

/** Slugify a string to URL-safe lowercase with hyphens */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Convert a filename (no ext) to a human-readable title */
function titleFromFilename(name: string): string {
  return name
    .replace(/^\d+\./, "")    // strip numeric prefix
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns { frontmatter, body }.
 */
function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };
  try {
    const fm = (parseYaml(match[1]) as Record<string, unknown>) ?? {};
    return { fm, body: match[2] };
  } catch {
    return { fm: {}, body: raw };
  }
}

/**
 * Serialise frontmatter + body back to a markdown string.
 */
function serialisePage(fm: Record<string, unknown>, body: string): string {
  const yaml = stringifyYaml(fm).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trimStart()}`;
}

/**
 * Write a file, creating parent directories as needed.
 * No-ops when dryRun is true.
 */
async function writeFile(path: string, content: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await ensureDir(dirname(path));
  await Deno.writeTextFile(path, content);
}

/** Copy a binary file, creating parent directories as needed. */
async function copyFile(src: string, dest: string, dryRun: boolean): Promise<void> {
  if (dryRun) return;
  await ensureDir(dirname(dest));
  await Deno.copyFile(src, dest);
}

/** Walk a directory recursively, yielding file paths. */
async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      yield* walk(path);
    } else if (entry.isFile) {
      yield path;
    }
  }
}

/** Zero-padded counter for numbered folder prefixes */
function pad(n: number, total: number): string {
  const width = String(total).length;
  return String(n).padStart(Math.max(width, 2), "0");
}

// ---------------------------------------------------------------------------
// Grav migration
// ---------------------------------------------------------------------------

/**
 * Strip Grav-specific frontmatter fields that have no Dune equivalent,
 * and remap fields that do.
 */
function transformGravFrontmatter(grav: Record<string, unknown>): Record<string, unknown> {
  const dune: Record<string, unknown> = {};

  // Direct mappings
  for (const key of ["title", "date", "published", "visible", "routable", "slug", "template", "taxonomy"] as const) {
    if (grav[key] !== undefined) dune[key] = grav[key];
  }

  // Grav uses header.* for some theme-level fields
  if (grav.header && typeof grav.header === "object") {
    const h = grav.header as Record<string, unknown>;
    if (h.image) dune.image = h.image;
    if (h.author) {
      dune.custom = { ...(dune.custom as Record<string, unknown> ?? {}), author: h.author };
    }
  }

  // Grav inline image/author at top level
  if (!dune.image && grav.image) dune.image = grav.image;
  if (!dune.custom && grav.author) {
    dune.custom = { author: grav.author };
  }

  // metadata block
  if (grav.metadata && typeof grav.metadata === "object") {
    dune.metadata = grav.metadata;
  }

  // routes/aliases
  if (grav.routes && typeof grav.routes === "object") {
    dune.routes = grav.routes;
  }

  // Grav summary
  if (grav.summary) dune.summary = grav.summary;

  // Silently drop: process, access, sitemap, cache_control, never_cache
  return dune;
}

export async function migrateFromGrav(
  srcDir: string,
  root: string,
  options: MigrateOptions = {},
): Promise<void> {
  const contentDir = options.out ?? join(root, "content");
  const dry = options.dryRun ?? false;

  log(`\n🏜️  Dune — migrate from Grav\n`);
  log(`  Source:  ${srcDir}`);
  log(`  Content: ${contentDir}${dry ? " (dry run)" : ""}\n`);

  if (!await exists(srcDir)) {
    console.error(`  ✗ Source not found: ${srcDir}`);
    Deno.exit(1);
  }

  // Grav content lives in <src>/user/pages/ or <src>/pages/ or <src>/ directly
  const candidates = [
    join(srcDir, "user", "pages"),
    join(srcDir, "pages"),
    srcDir,
  ];
  let gravPages = srcDir;
  for (const c of candidates) {
    if (await exists(join(c, "01.home")) || await exists(join(c, "default.md"))) {
      gravPages = c;
      break;
    }
  }

  const result: MigrateResult = { imported: 0, skipped: 0, errors: [] };

  for await (const filePath of walk(gravPages)) {
    const ext = extname(filePath).toLowerCase();
    const rel = filePath.slice(gravPages.length).replace(/^\//, "");

    if (ext === ".md") {
      try {
        const raw = await Deno.readTextFile(filePath);
        const { fm, body } = parseFrontmatter(raw);
        const duneFm = transformGravFrontmatter(fm);

        // Infer title from filename if missing
        if (!duneFm.title) {
          duneFm.title = titleFromFilename(basename(filePath, ".md"));
        }

        const dest = join(contentDir, rel);
        if (options.verbose) info(`  ${rel}`);
        await writeFile(dest, serialisePage(duneFm, body), dry);
        result.imported++;
      } catch (err) {
        result.errors.push(`${rel}: ${err}`);
      }
    } else if (!ext.match(/\.(yaml|yml|json|lock|sh|txt)$/i)) {
      // Copy media / assets as-is
      try {
        const dest = join(contentDir, rel);
        await copyFile(filePath, dest, dry);
      } catch { /* non-critical */ }
    }
  }

  printResult(result, dry);
}

// ---------------------------------------------------------------------------
// WordPress migration (WXR)
// ---------------------------------------------------------------------------

interface WpItem {
  title: string;
  slug: string;
  date: string;
  status: string;
  postType: string;
  content: string;
  categories: string[];
  tags: string[];
}

/** Minimal XML text-content extractor — no external parser needed */
function xmlText(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}
function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\/${tag}>`, "gi");
  const results: string[] = [];
  for (const m of xml.matchAll(re)) results.push(m[1].trim());
  return results;
}

function parseWxrItems(xml: string): WpItem[] {
  const items: WpItem[] = [];
  const itemBlocks = xml.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const block of itemBlocks) {
    const raw = block[1];
    const postType = xmlText(raw, "wp:post_type");
    if (postType !== "post" && postType !== "page") continue;

    const status = xmlText(raw, "wp:status");
    const title = xmlText(raw, "title") || "Untitled";
    const slug = xmlText(raw, "wp:post_name") || slugify(title);
    const date = xmlText(raw, "wp:post_date")?.split(" ")[0] ?? "";
    const content = xmlText(raw, "content:encoded");

    // Categories and tags from <category> elements
    const categories: string[] = [];
    const tags: string[] = [];
    const catRe = /<category[^>]+domain="(category|post_tag)"[^>]*>(?:<!\[CDATA\[)?([^\]<]*?)(?:\]\]>)?<\/category>/gi;
    for (const cm of raw.matchAll(catRe)) {
      const domain = cm[1];
      const val = cm[2].trim();
      if (val) {
        if (domain === "category") categories.push(val);
        else tags.push(val);
      }
    }

    items.push({ title, slug, date, status, postType, content, categories, tags });
  }
  return items;
}

export async function migrateFromWordPress(
  srcFile: string,
  root: string,
  options: MigrateOptions = {},
): Promise<void> {
  const contentDir = options.out ?? join(root, "content");
  const dry = options.dryRun ?? false;

  log(`\n🏜️  Dune — migrate from WordPress\n`);
  log(`  Source:  ${srcFile}`);
  log(`  Content: ${contentDir}${dry ? " (dry run)" : ""}\n`);

  if (!await exists(srcFile)) {
    console.error(`  ✗ Source not found: ${srcFile}`);
    Deno.exit(1);
  }

  const xml = await Deno.readTextFile(srcFile);
  const items = parseWxrItems(xml);

  if (!items.length) {
    warn("No posts or pages found in WXR file. Is this a valid WordPress export?");
    Deno.exit(1);
  }

  log(`  Found ${items.length} items (posts + pages)\n`);

  const result: MigrateResult = { imported: 0, skipped: 0, errors: [] };

  // Separate posts from pages
  const posts = items.filter((i) => i.postType === "post");
  const pages = items.filter((i) => i.postType === "page");

  // Write blog posts into content/01.blog/
  if (posts.length) {
    let idx = 1;
    for (const post of posts.sort((a, b) => a.date.localeCompare(b.date))) {
      const prefix = pad(idx++, posts.length);
      const folderName = `${prefix}.${post.slug}`;
      const fm: Record<string, unknown> = {
        title: post.title,
        date: post.date || undefined,
        published: post.status === "publish",
        status: post.status === "publish" ? "published" : "draft",
      };
      if (post.categories.length) fm.taxonomy = { ...((fm.taxonomy as object) ?? {}), category: post.categories };
      if (post.tags.length) fm.taxonomy = { ...((fm.taxonomy as object) ?? {}), tag: post.tags };

      const dest = join(contentDir, "01.blog", folderName, "post.md");
      // WordPress content is HTML — use it directly (Dune markdown passes through HTML)
      const body = post.content;
      if (options.verbose) info(`blog/${folderName}/post.md`);
      try {
        await writeFile(dest, serialisePage(fm, body), dry);
        result.imported++;
      } catch (err) {
        result.errors.push(`${folderName}: ${err}`);
      }
    }
    // Create blog listing page if it doesn't exist
    const blogDefault = join(contentDir, "01.blog", "default.md");
    if (!await exists(blogDefault)) {
      const blogFm: Record<string, unknown> = {
        title: "Blog",
        published: true,
        collection: { items: { "@self.children": true }, order: { by: "date", dir: "desc" } },
      };
      await writeFile(blogDefault, serialisePage(blogFm, ""), dry);
    }
  }

  // Write static pages at top level
  if (pages.length) {
    let idx = posts.length ? 2 : 1;
    for (const page of pages) {
      const prefix = pad(idx++, pages.length + (posts.length ? 1 : 0));
      const folderName = `${prefix}.${page.slug}`;
      const fm: Record<string, unknown> = {
        title: page.title,
        date: page.date || undefined,
        published: page.status === "publish",
      };

      const dest = join(contentDir, folderName, "default.md");
      if (options.verbose) info(`${folderName}/default.md`);
      try {
        await writeFile(dest, serialisePage(fm, page.content), dry);
        result.imported++;
      } catch (err) {
        result.errors.push(`${folderName}: ${err}`);
      }
    }
  }

  printResult(result, dry);
}

// ---------------------------------------------------------------------------
// Generic markdown folder migration
// ---------------------------------------------------------------------------

export async function migrateFromMarkdown(
  srcDir: string,
  root: string,
  options: MigrateOptions = {},
): Promise<void> {
  const contentDir = options.out ?? join(root, "content");
  const dry = options.dryRun ?? false;

  log(`\n🏜️  Dune — migrate from markdown folder\n`);
  log(`  Source:  ${srcDir}`);
  log(`  Content: ${contentDir}${dry ? " (dry run)" : ""}\n`);

  if (!await exists(srcDir)) {
    console.error(`  ✗ Source not found: ${srcDir}`);
    Deno.exit(1);
  }

  const result: MigrateResult = { imported: 0, skipped: 0, errors: [] };

  // Collect all .md files at top level (non-recursive first pass)
  const mdFiles: string[] = [];
  for await (const entry of Deno.readDir(srcDir)) {
    if (entry.isFile && extname(entry.name).toLowerCase() === ".md") {
      mdFiles.push(entry.name);
    }
  }
  mdFiles.sort();

  let idx = 1;
  for (const filename of mdFiles) {
    const src = join(srcDir, filename);
    const nameNoExt = basename(filename, ".md");

    // Skip README, CHANGELOG, etc.
    if (nameNoExt.toUpperCase() === nameNoExt) {
      result.skipped++;
      continue;
    }

    const slug = slugify(nameNoExt);
    const prefix = pad(idx++, mdFiles.length);
    const folderName = `${prefix}.${slug}`;

    try {
      const raw = await Deno.readTextFile(src);
      const { fm, body } = parseFrontmatter(raw);

      if (!fm.title) {
        fm.title = titleFromFilename(nameNoExt);
      }
      if (fm.published === undefined) fm.published = true;

      const dest = join(contentDir, folderName, "default.md");
      if (options.verbose) info(`${folderName}/default.md  ←  ${filename}`);
      await writeFile(dest, serialisePage(fm, body), dry);
      result.imported++;
    } catch (err) {
      result.errors.push(`${filename}: ${err}`);
    }
  }

  // Recurse into subdirectories that aren't clearly system folders
  const systemDirs = new Set(["node_modules", ".git", ".github", "dist", "build", "out", "_site"]);
  for await (const entry of Deno.readDir(srcDir)) {
    if (!entry.isDirectory || systemDirs.has(entry.name)) continue;

    const subSrc = join(srcDir, entry.name);
    const slug = slugify(entry.name);
    const prefix = pad(idx++, mdFiles.length + 10);
    const subDest = join(contentDir, `${prefix}.${slug}`);

    // Recursively process sub-directory markdown files
    for await (const filePath of walk(subSrc)) {
      const ext = extname(filePath).toLowerCase();
      const rel = filePath.slice(subSrc.length).replace(/^\//, "");
      if (ext === ".md") {
        try {
          const raw = await Deno.readTextFile(filePath);
          const { fm, body } = parseFrontmatter(raw);
          if (!fm.title) fm.title = titleFromFilename(basename(filePath, ".md"));
          if (fm.published === undefined) fm.published = true;
          const relSlug = rel.replace(/\.md$/, "").split("/").map(slugify).join("/");
          const dest = join(subDest, relSlug, "default.md");
          if (options.verbose) info(`${basename(subDest)}/${rel}`);
          await writeFile(dest, serialisePage(fm, body), dry);
          result.imported++;
        } catch (err) {
          result.errors.push(`${rel}: ${err}`);
        }
      } else if (!ext.match(/\.(lock|sh|log)$/i)) {
        try {
          await copyFile(filePath, join(subDest, rel), dry);
        } catch { /* non-critical */ }
      }
    }
  }

  printResult(result, dry);
}

// ---------------------------------------------------------------------------
// Hugo migration
// ---------------------------------------------------------------------------

/** Parse TOML frontmatter (basic key=value, no nested tables) */
function parseTomlBasic(toml: string): Record<string, unknown> {
  const fm: Record<string, unknown> = {};
  for (const line of toml.split("\n")) {
    const m = line.match(/^\s*(\w+)\s*=\s*(.+)$/);
    if (!m) continue;
    const key = m[1];
    let val: unknown = m[2].trim();
    if (typeof val === "string") {
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      else if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      else if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (!isNaN(Number(val)) && val !== "") val = Number(val);
      else if (val.startsWith("[") && val.endsWith("]")) {
        val = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      }
    }
    fm[key] = val;
  }
  return fm;
}

/** Parse Hugo frontmatter (YAML, TOML, or JSON) + body */
function parseHugoFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  // YAML: ---
  const yamlM = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (yamlM) {
    try {
      return { fm: (parseYaml(yamlM[1]) as Record<string, unknown>) ?? {}, body: yamlM[2] };
    } catch { /* fall through */ }
  }
  // TOML: +++
  const tomlM = raw.match(/^\+\+\+\r?\n([\s\S]*?)\r?\n\+\+\+\r?\n?([\s\S]*)$/);
  if (tomlM) {
    return { fm: parseTomlBasic(tomlM[1]), body: tomlM[2] };
  }
  // JSON: {…}
  const jsonM = raw.match(/^(\{[\s\S]*?\})\r?\n([\s\S]*)$/);
  if (jsonM) {
    try {
      return { fm: JSON.parse(jsonM[1]) as Record<string, unknown>, body: jsonM[2] };
    } catch { /* fall through */ }
  }
  return { fm: {}, body: raw };
}

/** Convert Hugo frontmatter to Dune frontmatter */
function transformHugoFrontmatter(hugo: Record<string, unknown>): Record<string, unknown> {
  const dune: Record<string, unknown> = {};

  // Title
  if (hugo.title) dune.title = hugo.title;

  // Date — Hugo uses various formats
  const dateVal = hugo.date ?? hugo.publishDate ?? hugo.lastmod;
  if (dateVal) {
    const d = String(dateVal).split("T")[0]; // keep date part only
    dune.date = d;
  }

  // Published (Hugo uses draft:true to mark unpublished)
  dune.published = hugo.draft !== true;

  // Slug
  if (hugo.slug) dune.slug = hugo.slug;
  if (hugo.url) dune.slug = String(hugo.url).replace(/^\/|\/$/g, "").split("/").pop();

  // Taxonomy — Hugo uses flat tags/categories arrays
  const taxonomy: Record<string, string[]> = {};
  if (Array.isArray(hugo.tags) && hugo.tags.length) taxonomy.tag = hugo.tags as string[];
  if (Array.isArray(hugo.categories) && hugo.categories.length) taxonomy.category = hugo.categories as string[];
  if (Object.keys(taxonomy).length) dune.taxonomy = taxonomy;

  // Aliases
  if (Array.isArray(hugo.aliases) && hugo.aliases.length) {
    dune.routes = { aliases: hugo.aliases };
  }

  // Description → metadata
  if (hugo.description || hugo.summary) {
    dune.metadata = { description: String(hugo.description ?? hugo.summary) };
  }

  // Author → custom
  if (hugo.author || hugo.authors) {
    dune.custom = { author: hugo.author ?? hugo.authors };
  }

  // Weight → order
  if (typeof hugo.weight === "number") dune.order = hugo.weight;

  // Silently drop: layout, outputs, params, build, cascade, render
  return dune;
}

export async function migrateFromHugo(
  srcDir: string,
  root: string,
  options: MigrateOptions = {},
): Promise<void> {
  const contentDir = options.out ?? join(root, "content");
  const dry = options.dryRun ?? false;

  log(`\n🏜️  Dune — migrate from Hugo\n`);
  log(`  Source:  ${srcDir}`);
  log(`  Content: ${contentDir}${dry ? " (dry run)" : ""}\n`);

  if (!await exists(srcDir)) {
    console.error(`  ✗ Source not found: ${srcDir}`);
    Deno.exit(1);
  }

  // Hugo content is in <src>/content/
  const hugoContent = (await exists(join(srcDir, "content")))
    ? join(srcDir, "content")
    : srcDir;

  const hugoStatic = join(srcDir, "static");

  const result: MigrateResult = { imported: 0, skipped: 0, errors: [] };

  // Walk content directory, preserving folder structure
  for await (const filePath of walk(hugoContent)) {
    const rel = filePath.slice(hugoContent.length).replace(/^\//, "");
    const ext = extname(filePath).toLowerCase();

    if (ext === ".md") {
      try {
        const raw = await Deno.readTextFile(filePath);
        const { fm: hugoFm, body } = parseHugoFrontmatter(raw);
        const duneFm = transformHugoFrontmatter(hugoFm);

        // Hugo _index.md → Dune default.md (section listing pages)
        const destRel = rel.replace(/_index\.md$/, "default.md");

        if (!duneFm.title) {
          duneFm.title = titleFromFilename(basename(rel, ".md"));
        }

        // Convert Hugo numbered sections to Dune format (already numbered usually)
        const dest = join(contentDir, destRel);
        if (options.verbose) info(destRel);
        await writeFile(dest, serialisePage(duneFm, body), dry);
        result.imported++;
      } catch (err) {
        result.errors.push(`${rel}: ${err}`);
      }
    } else if (!ext.match(/\.(toml|json|lock|sh|log)$/i)) {
      // Copy non-markdown assets co-located with content
      try {
        await copyFile(filePath, join(contentDir, rel), dry);
      } catch { /* non-critical */ }
    }
  }

  // Copy Hugo static/ to Dune static/ (or site root)
  if (await exists(hugoStatic)) {
    const duneStatic = join(root, "static");
    let staticCount = 0;
    for await (const filePath of walk(hugoStatic)) {
      const rel = filePath.slice(hugoStatic.length).replace(/^\//, "");
      try {
        await copyFile(filePath, join(duneStatic, rel), dry);
        staticCount++;
      } catch { /* non-critical */ }
    }
    if (staticCount > 0) info(`Copied ${staticCount} static asset(s) → static/`);
  }

  printResult(result, dry);
}

// ---------------------------------------------------------------------------
// Shared result printer
// ---------------------------------------------------------------------------

function printResult(result: MigrateResult, dry: boolean): void {
  log("");
  if (dry) {
    log(`  Dry run — no files written`);
  }
  log(`  ✅  Imported: ${result.imported}`);
  if (result.skipped > 0) log(`  ⏭️  Skipped:  ${result.skipped}`);
  if (result.errors.length > 0) {
    log(`  ❌  Errors:   ${result.errors.length}`);
    for (const e of result.errors) warn(e);
  }
  log("");
}
