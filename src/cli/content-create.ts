/**
 * dune content:create <route> — Scaffold a new content page.
 *
 * Resolves the correct filesystem path for a given route (including
 * honouring existing numeric-prefix folders), creates parent directories
 * as needed, and writes a default.md with starter frontmatter.
 *
 * Usage:
 *   dune content:create /blog/my-new-post
 *   dune content:create /about --title "About Us" --template default
 *   dune content:create /blog/draft-post --no-publish
 *   dune content:create /docs/guide --flat       # creates guide.md instead of guide/default.md
 *   dune content:create /blog/post --json        # print created path as JSON
 */

import { join, resolve } from "@std/path";
import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";

export interface ContentCreateOptions {
  debug?: boolean;
  /** Page title (default: derived from slug) */
  title?: string;
  /** Template name (default: "default") */
  template?: string;
  /** Write as a flat file (slug.md) instead of slug/default.md */
  flat?: boolean;
  /** Create as published (default: false — draft) */
  publish?: boolean;
  /** Output machine-parseable JSON */
  json?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Read dir entries and return a map of slug → actual folder name (with any numeric prefix) */
async function readDirSlugs(dirPath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for await (const entry of Deno.readDir(dirPath)) {
      if (!entry.isDirectory) continue;
      const name = entry.name;
      if (name.startsWith(".")) continue;

      // Strip numeric prefix: "01.blog" → "blog"
      const slug = name.match(/^\d+\.(.+)$/)?.[1] ?? name.replace(/^_/, "");
      map.set(slug, name);
    }
  } catch {
    // Dir may not exist yet
  }
  return map;
}

/** Determine the next numeric prefix for a new folder in a directory */
async function nextPrefix(dirPath: string): Promise<number> {
  let max = 0;
  try {
    for await (const entry of Deno.readDir(dirPath)) {
      if (!entry.isDirectory) continue;
      const m = entry.name.match(/^(\d+)\./);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  } catch {
    // Dir may not exist
  }
  return max + 1;
}

/** Generate minimal frontmatter YAML */
function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      // Quote strings containing special chars
      const needsQuote = /[:{}\[\],|>&*!%@`]/.test(value) ||
        value.trim() !== value || value === "" || value === "null" ||
        value === "true" || value === "false";
      lines.push(`${key}: ${needsQuote ? `"${value.replace(/"/g, '\\"')}"` : value}`);
    } else {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function contentCreateCommand(
  root: string,
  routePath: string,
  options: ContentCreateOptions = {},
): Promise<void> {
  root = resolve(root);

  if (!routePath) {
    console.error("  ✗ Usage: dune content:create <route>");
    console.error("    Example: dune content:create /blog/my-new-post");
    Deno.exit(1);
  }

  // Normalise route: remove leading slash, split into segments
  const normalised = routePath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!normalised) {
    console.error("  ✗ Route cannot be empty");
    Deno.exit(1);
  }
  const segments = normalised.split("/").filter(Boolean);

  // Load config for content dir
  const storage = createStorage({ rootDir: root });
  let contentDirName = "content";
  try {
    const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
    contentDirName = config.system.content.dir ?? "content";
  } catch {
    // Use default
  }
  const contentRoot = join(root, contentDirName);

  // Walk segments, resolving existing folders with numeric prefixes
  let currentDir = contentRoot;
  const resolvedParts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (isLast && !options.flat) {
      // Last segment becomes a folder (folder-based page: slug/default.md)
      const slugMap = await readDirSlugs(currentDir);
      let folderName: string;

      if (slugMap.has(seg)) {
        // Folder already exists — use it
        folderName = slugMap.get(seg)!;
      } else {
        // Create new folder with next numeric prefix
        const prefix = await nextPrefix(currentDir);
        folderName = `${String(prefix).padStart(2, "0")}.${seg}`;
      }

      resolvedParts.push(folderName);
      currentDir = join(currentDir, folderName);
    } else if (isLast && options.flat) {
      // Last segment is a flat file — don't add to resolvedParts yet, just record dir
    } else {
      // Intermediate segment — resolve to existing folder or create one
      const slugMap = await readDirSlugs(currentDir);

      let folderName: string;
      if (slugMap.has(seg)) {
        folderName = slugMap.get(seg)!;
      } else {
        const prefix = await nextPrefix(currentDir);
        folderName = `${String(prefix).padStart(2, "0")}.${seg}`;
      }

      resolvedParts.push(folderName);
      currentDir = join(currentDir, folderName);
    }
  }

  // Determine the final file path
  const lastSeg = segments[segments.length - 1];
  let filePath: string;

  if (options.flat) {
    // Flat file: currentDir/slug.md
    filePath = join(currentDir, `${lastSeg}.md`);
  } else {
    // Folder-based: currentDir/default.md
    filePath = join(currentDir, "default.md");
  }

  // Check if file already exists
  try {
    await Deno.stat(filePath);
    const rel = filePath.replace(root + "/", "");
    if (options.json) {
      console.log(JSON.stringify({ error: `File already exists: ${rel}`, path: rel }, null, 2));
    } else {
      console.error(`  ✗ File already exists: ${rel}`);
    }
    Deno.exit(1);
  } catch {
    // Good — doesn't exist
  }

  // Build title from slug or option
  const finalSlug = lastSeg;
  const title = options.title ??
    finalSlug
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

  // Build frontmatter
  const today = new Date().toISOString().slice(0, 10);
  const frontmatter = buildFrontmatter({
    title,
    ...(options.template && options.template !== "default"
      ? { template: options.template }
      : {}),
    date: today,
    published: options.publish === true ? true : false,
  });

  const body = `# ${title}\n`;
  const fileContent = `${frontmatter}\n${body}`;

  // Create directories and write file
  await Deno.mkdir(currentDir, { recursive: true });
  await Deno.writeTextFile(filePath, fileContent);

  const relPath = filePath.replace(root + "/", "");
  const route = "/" + normalised;

  if (options.json) {
    console.log(JSON.stringify({
      created: true,
      route,
      path: relPath,
      title,
      published: options.publish === true,
      template: options.template ?? "default",
    }, null, 2));
    return;
  }

  console.log(`🏜️  Dune — content create\n`);
  console.log(`  ✅ ${relPath}`);
  console.log(`     Route: ${route}`);
  console.log(`     Title: ${title}`);
  console.log(`     Template: ${options.template ?? "default"}`);
  console.log(`     Status: ${options.publish ? "published" : "draft"}`);
  console.log(`\n  Edit: ${relPath}`);
}
