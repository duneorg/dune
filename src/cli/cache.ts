/**
 * dune cache:* — Cache management commands.
 */

import { bootstrap } from "./bootstrap.ts";

export interface CacheOptions {
  debug?: boolean;
}

export const cacheCommands = {
  /**
   * dune cache:clear — Clear all caches.
   */
  async clear(root: string) {
    console.log("🏜️  Dune — clearing caches...\n");

    // Clear .dune/cache directory if it exists
    const cacheDir = `${root}/.dune/cache`;
    try {
      await Deno.remove(cacheDir, { recursive: true });
      console.log(`  ✅ Cleared: ${cacheDir}`);
    } catch {
      console.log("  ℹ️  No cache directory found");
    }

    // Clear search index
    const searchIndex = `${root}/.dune/search-index.json`;
    try {
      await Deno.remove(searchIndex);
      console.log(`  ✅ Cleared: search index`);
    } catch {
      // No search index
    }

    console.log("\n  ✅ Cache cleared");
  },

  /**
   * dune cache:rebuild — Rebuild content index from scratch.
   */
  async rebuild(root: string, options: CacheOptions = {}) {
    console.log("🏜️  Dune — rebuilding content index...\n");

    const start = performance.now();

    // Bootstrap with full search rebuild
    const ctx = await bootstrap(root, {
      debug: options.debug,
      buildSearch: true,
    });

    const elapsed = (performance.now() - start).toFixed(0);
    console.log(`  📄 ${ctx.engine.pages.length} pages indexed`);
    console.log(`  🔍 Search index rebuilt`);
    console.log(`\n  ✅ Index rebuilt in ${elapsed}ms`);
  },
};
