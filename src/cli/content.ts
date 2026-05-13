/**
 * dune content:* — Content inspection and validation commands.
 */

import { bootstrap } from "./bootstrap.ts";

export interface ContentOptions {
  debug?: boolean;
  /** Output machine-parseable JSON instead of human-readable text. */
  json?: boolean;
}

export const contentCommands = {
  /**
   * dune content:list — List all pages with routes, templates, and formats.
   */
  async list(root: string, options: ContentOptions = {}) {
    const ctx = await bootstrap(root, { debug: options.debug });
    const { engine } = ctx;

    const sorted = [...engine.pages].sort((a, b) =>
      a.route.localeCompare(b.route)
    );

    if (options.json) {
      const output = {
        total: engine.pages.length,
        published: engine.pages.filter((p) => p.published).length,
        drafts: engine.pages.filter((p) => !p.published).length,
        pages: sorted.map((p) => ({
          route: p.route,
          template: p.template,
          format: p.format,
          published: p.published,
          sourcePath: p.sourcePath,
          title: p.title ?? null,
          language: p.language ?? null,
        })),
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log("🏜️  Dune — content listing\n");

    // Header
    const header = `  ${"Route".padEnd(40)} ${"Template".padEnd(15)} ${"Format".padEnd(6)} ${"Published"}`;
    console.log(header);
    console.log("  " + "─".repeat(header.length - 2));

    for (const page of sorted) {
      const route = (page.route || "(no route)").padEnd(40);
      const template = page.template.padEnd(15);
      const format = page.format.padEnd(6);
      const published = page.published ? "✅" : "📝";
      console.log(`  ${route} ${template} ${format} ${published}`);
    }

    console.log(`\n  Total: ${engine.pages.length} pages`);
    console.log(`  Published: ${engine.pages.filter((p) => p.published).length}`);
    console.log(`  Drafts: ${engine.pages.filter((p) => !p.published).length}`);
  },

  /**
   * dune content:check — Validate content for common issues.
   */
  async check(root: string, options: ContentOptions = {}) {
    const ctx = await bootstrap(root, { debug: options.debug });
    const { engine } = ctx;

    const issues: Array<{ sourcePath: string; message: string }> = [];

    for (const page of engine.pages) {
      // Check for missing titles
      if (!page.title) {
        issues.push({ sourcePath: page.sourcePath, message: "Missing title" });
      }

      // Check for empty routes (non-module pages should have routes)
      if (!page.route && !page.isModule) {
        issues.push({ sourcePath: page.sourcePath, message: "No route generated" });
      }

      // Check for duplicate routes
      const duplicates = engine.pages.filter(
        (p) => p.route === page.route && p.sourcePath !== page.sourcePath,
      );
      if (duplicates.length > 0 && page.route) {
        issues.push({
          sourcePath: page.sourcePath,
          message: `Duplicate route "${page.route}" (also: ${
            duplicates.map((d) => d.sourcePath).join(", ")
          })`,
        });
      }

      // Check for future dates
      if (page.date) {
        const pageDate = new Date(page.date);
        if (pageDate > new Date()) {
          issues.push({ sourcePath: page.sourcePath, message: `Future date (${page.date})` });
        }
      }
    }

    // Deduplicate by stringifying
    const seen = new Set<string>();
    const unique = issues.filter((issue) => {
      const key = `${issue.sourcePath}:${issue.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (options.json) {
      const output = {
        valid: unique.length === 0,
        pagesChecked: engine.pages.length,
        issues: unique,
      };
      console.log(JSON.stringify(output, null, 2));
      if (unique.length > 0) Deno.exit(1);
      return;
    }

    console.log("🏜️  Dune — content validation\n");

    if (unique.length === 0) {
      console.log("  ✅ All content checks passed");
    } else {
      console.log(`  ⚠️  ${unique.length} issue(s) found:\n`);
      for (const issue of unique) {
        console.log(`  ✗ ${issue.sourcePath}: ${issue.message}`);
      }
    }

    console.log(`\n  📄 ${engine.pages.length} pages checked`);
  },
};
