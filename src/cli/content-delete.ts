/**
 * dune content:delete <route> — Delete a content page by route.
 *
 * Resolves the filesystem path for the given route (using the content index
 * or config), then removes the page's source file (and optionally its
 * containing folder if it becomes empty).
 *
 * Usage:
 *   dune content:delete /blog/old-post              # interactive (requires --confirm)
 *   dune content:delete /blog/old-post --confirm    # delete without prompting
 *   dune content:delete /blog/old-post --dry-run    # show what would be deleted
 *   dune content:delete /blog/old-post --json       # structured output
 *
 * Safety:
 *   - Requires --confirm (or --dry-run) to prevent accidents
 *   - Never deletes files outside the content directory
 *   - Removes the parent folder if it becomes empty after deletion
 */

import { dirname, join, resolve } from "@std/path";
import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { bootstrap } from "./bootstrap.ts";

export interface ContentDeleteOptions {
  debug?: boolean;
  /** Confirm deletion without interactive prompt */
  confirm?: boolean;
  /** Preview what would be deleted without actually deleting */
  dryRun?: boolean;
  /** Output machine-parseable JSON */
  json?: boolean;
}

export async function contentDeleteCommand(
  root: string,
  routePath: string,
  options: ContentDeleteOptions = {},
): Promise<void> {
  root = resolve(root);

  if (!routePath) {
    console.error("  ✗ Usage: dune content:delete <route>");
    console.error("    Example: dune content:delete /blog/old-post");
    Deno.exit(1);
  }

  if (!options.dryRun && !options.confirm) {
    if (options.json) {
      console.log(JSON.stringify({
        error: "Deletion requires --confirm or --dry-run flag",
        route: routePath,
      }, null, 2));
    } else {
      console.error("  ✗ Deletion requires --confirm or --dry-run to prevent accidents");
      console.error(`    dune content:delete ${routePath} --dry-run`);
      console.error(`    dune content:delete ${routePath} --confirm`);
    }
    Deno.exit(1);
  }

  const normalised = routePath.startsWith("/") ? routePath : `/${routePath}`;

  // Bootstrap to get content index (so we can resolve the route)
  const storage = createStorage({ rootDir: root });
  let contentDirName = "content";
  try {
    const config = await loadConfig({ storage, rootDir: root, skipConfigTs: true });
    contentDirName = config.system.content.dir ?? "content";
  } catch {
    // Use default
  }

  // Try to find the page in the content index via bootstrap
  let sourcePath: string | null = null;
  try {
    const ctx = await bootstrap(root, { debug: options.debug });
    const page = ctx.engine.pages.find((p) => p.route === normalised);
    if (page) sourcePath = page.sourcePath;
  } catch {
    // Bootstrap may fail if server isn't configured — fall through to filesystem scan
  }

  if (!sourcePath) {
    // Fallback: search the content directory for the file
    // Normalize the route to a best-guess path
    const segments = normalised.slice(1).split("/").filter(Boolean);
    if (segments.length === 0) {
      console.error("  ✗ Cannot delete the root route");
      Deno.exit(1);
    }

    // Try to find default.md in a folder matching the last segment
    const contentRoot = join(root, contentDirName);
    sourcePath = await findContentFile(contentRoot, segments);
  }

  if (!sourcePath) {
    const msg = `No content file found for route: ${normalised}`;
    if (options.json) {
      console.log(JSON.stringify({ error: msg, route: normalised }, null, 2));
    } else {
      console.error(`  ✗ ${msg}`);
    }
    Deno.exit(1);
  }

  const contentRoot = join(root, contentDirName);
  const absFilePath = join(contentRoot, sourcePath);
  const absDir = dirname(absFilePath);

  // Security check: ensure the file is within the content root
  if (!absFilePath.startsWith(contentRoot + "/") && absFilePath !== contentRoot) {
    const msg = "Path traversal detected — refusing to delete";
    if (options.json) {
      console.log(JSON.stringify({ error: msg }, null, 2));
    } else {
      console.error(`  ✗ ${msg}`);
    }
    Deno.exit(1);
  }

  // Check if file exists
  try {
    await Deno.stat(absFilePath);
  } catch {
    const msg = `File not found: ${sourcePath}`;
    if (options.json) {
      console.log(JSON.stringify({ error: msg, sourcePath }, null, 2));
    } else {
      console.error(`  ✗ ${msg}`);
    }
    Deno.exit(1);
  }

  // Check if parent dir becomes empty after deletion (only for folder-based pages)
  const isDefaultMd = absFilePath.endsWith("/default.md") ||
    absFilePath.endsWith("\\default.md");
  let dirWouldBeEmpty = false;
  if (isDefaultMd) {
    try {
      const entries: string[] = [];
      for await (const entry of Deno.readDir(absDir)) {
        entries.push(entry.name);
      }
      dirWouldBeEmpty = entries.length === 1; // Only default.md
    } catch {
      // Ignore
    }
  }

  const relPath = sourcePath;

  // Dry run — just report
  if (options.dryRun) {
    if (options.json) {
      console.log(JSON.stringify({
        dryRun: true,
        route: normalised,
        wouldDelete: [
          relPath,
          ...(dirWouldBeEmpty ? [dirname(relPath) + "/"] : []),
        ],
      }, null, 2));
    } else {
      console.log(`🏜️  Dune — content delete (dry run)\n`);
      console.log(`  Would delete: ${relPath}`);
      if (dirWouldBeEmpty) {
        console.log(`  Would remove: ${dirname(relPath)}/ (becomes empty)`);
      }
      console.log(`\n  Run with --confirm to delete`);
    }
    return;
  }

  // Actually delete
  await Deno.remove(absFilePath);
  const deleted: string[] = [relPath];

  if (dirWouldBeEmpty) {
    try {
      await Deno.remove(absDir);
      deleted.push(dirname(relPath) + "/");
    } catch {
      // Non-fatal — ignore
    }
  }

  if (options.json) {
    console.log(JSON.stringify({
      deleted: true,
      route: normalised,
      files: deleted,
    }, null, 2));
    return;
  }

  console.log(`🏜️  Dune — content delete\n`);
  for (const f of deleted) {
    console.log(`  ✅ Deleted: ${f}`);
  }
  console.log(`\n  Route ${normalised} removed from content`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Walk the content directory looking for a file matching the route segments.
 * Handles numeric prefix folders (01.blog, 02.about, etc) and flat .md files.
 */
async function findContentFile(
  contentRoot: string,
  segments: string[],
): Promise<string | null> {
  let currentDir = contentRoot;
  const resolvedParts: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;

    if (isLast) {
      // 1. Direct (no prefix) folder with default.md
      try {
        await Deno.stat(join(currentDir, seg, "default.md"));
        return [...resolvedParts, seg, "default.md"].join("/");
      } catch { /* not found */ }

      // 2. Direct flat file (no prefix)
      try {
        await Deno.stat(join(currentDir, `${seg}.md`));
        return [...resolvedParts, `${seg}.md`].join("/");
      } catch { /* not found */ }

      // 3. Prefix-stripped scan — handles 01.blog/, 02.about/, _hidden/, etc.
      try {
        for await (const entry of Deno.readDir(currentDir)) {
          const base = entry.name.replace(/^\d+\./, "").replace(/^_/, "");
          if (entry.isDirectory && base === seg) {
            // Folder whose stripped name matches — look for default.md inside
            try {
              await Deno.stat(join(currentDir, entry.name, "default.md"));
              return [...resolvedParts, entry.name, "default.md"].join("/");
            } catch { /* no default.md */ }
          } else if (entry.isFile && base === `${seg}.md`) {
            // File whose stripped name (e.g. "01.about.md" → "about.md") matches
            return [...resolvedParts, entry.name].join("/");
          }
        }
      } catch { /* ignore */ }

      return null;
    } else {
      // Intermediate segment: must resolve to a directory
      let matched: string | null = null;
      try {
        for await (const entry of Deno.readDir(currentDir)) {
          if (!entry.isDirectory) continue;
          const stripped = entry.name.replace(/^\d+\./, "").replace(/^_/, "");
          if (stripped === seg) {
            matched = entry.name;
            break;
          }
        }
      } catch {
        return null;
      }

      if (!matched) return null;
      resolvedParts.push(matched);
      currentDir = join(currentDir, matched);
    }
  }

  return null;
}
