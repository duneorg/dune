/**
 * Island bundling — scans a theme's islands/ directory and uses Fresh 2's
 * Builder to compile island TSX files into browser-ready JS chunks.
 *
 * Call buildIslands(app, siteRoot, themeName) before app.handler() so that
 * the build cache is registered and /_fresh/js/* routes are available.
 */

import { Builder } from "jsr:@fresh/core@^2/dev";
import type { App } from "fresh";
import { join } from "@std/path";

/**
 * Build island bundles for the given theme and attach them to the Fresh App.
 * Returns true when islands were found and bundled, false when the theme has
 * no islands/ directory (or it is empty).
 */
export async function buildIslands(
  app: App,
  siteRoot: string,
  themeName: string,
  mode: "production" | "development" = "production",
): Promise<boolean> {
  const islandDir = join(siteRoot, "themes", themeName, "islands");
  try {
    const entries = await Array.fromAsync(Deno.readDir(islandDir));
    const hasTsx = entries.some((e) =>
      e.isFile && (e.name.endsWith(".tsx") || e.name.endsWith(".ts"))
    );
    if (!hasTsx) return false;
  } catch {
    return false;
  }

  const builder = new Builder({ root: siteRoot, islandDir });
  const applyBuildCache = await builder.build({ mode, snapshot: "memory" });
  applyBuildCache(app);
  return true;
}
