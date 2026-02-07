/**
 * dune content:* — Content inspection and validation commands.
 */

import { bootstrap } from "./bootstrap.ts";

export interface ContentOptions {
  debug?: boolean;
}

export const contentCommands = {
  /**
   * dune content:list — List all pages with routes, templates, and formats.
   */
  async list(root: string, options: ContentOptions = {}) {
    console.log("🏜️  Dune — content listing\n");

    const ctx = await bootstrap(root, { debug: options.debug });
    const { engine } = ctx;

    // Header
    const header = `  ${"Route".padEnd(40)} ${"Template".padEnd(15)} ${"Format".padEnd(6)} ${"Published"}`;
    console.log(header);
    console.log("  " + "─".repeat(header.length - 2));

    // Sort by route
    const sorted = [...engine.pages].sort((a, b) =>
      a.route.localeCompare(b.route)
    );

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
    console.log("🏜️  Dune — content validation\n");

    const ctx = await bootstrap(root, { debug: options.debug });
    const { engine } = ctx;

    const issues: string[] = [];

    for (const page of engine.pages) {
      // Check for missing titles
      if (!page.title) {
        issues.push(`${page.sourcePath}: Missing title`);
      }

      // Check for empty routes (non-module pages should have routes)
      if (!page.route && !page.isModule) {
        issues.push(`${page.sourcePath}: No route generated`);
      }

      // Check for duplicate routes
      const duplicates = engine.pages.filter(
        (p) => p.route === page.route && p.sourcePath !== page.sourcePath,
      );
      if (duplicates.length > 0 && page.route) {
        issues.push(
          `${page.sourcePath}: Duplicate route "${page.route}" (also: ${
            duplicates.map((d) => d.sourcePath).join(", ")
          })`,
        );
      }

      // Check for future dates
      if (page.date) {
        const pageDate = new Date(page.date);
        if (pageDate > new Date()) {
          issues.push(`${page.sourcePath}: Future date (${page.date})`);
        }
      }
    }

    // Deduplicate issues
    const unique = [...new Set(issues)];

    if (unique.length === 0) {
      console.log("  ✅ All content checks passed");
    } else {
      console.log(`  ⚠️  ${unique.length} issue(s) found:\n`);
      for (const issue of unique) {
        console.log(`  ✗ ${issue}`);
      }
    }

    console.log(`\n  📄 ${engine.pages.length} pages checked`);
  },
};
