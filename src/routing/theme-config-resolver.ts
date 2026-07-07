import { dirname } from "@std/path";
import type { Page, PageIndex } from "../content/types.ts";
import type { DuneEngine } from "../core/engine.ts";

/**
 * Resolve the effective theme config for a page: the site-level config
 * (from the namespaced `data/theme-config.json`), shallow-merged with any
 * ancestor section's `theme_config` frontmatter (farthest ancestor first,
 * nearest ancestor last — closest wins), shallow-merged with the page's own
 * `theme_config` frontmatter last.
 *
 * Mirrors the ancestor-walk pattern used by the sitemap generator's
 * `hasUnpublishedAncestor()` (src/sitemap/generator.ts), but loads full
 * pages (not just index entries) since `theme_config` lives in frontmatter.
 */
export async function resolveThemeConfig(
  page: Page,
  engine: DuneEngine,
): Promise<Record<string, unknown>> {
  const ancestorOverrides: Record<string, unknown>[] = [];

  const pageIndex = engine.pages.find((p) => p.sourcePath === page.sourcePath);
  let current: PageIndex | undefined = pageIndex;
  const seen = new Set<string>();

  while (current?.parentPath) {
    // Cycle guard: flat-file pages have parentPath === dirname(sourcePath),
    // which would otherwise find the same page and loop forever.
    const key = `${current.sourcePath}|${current.language ?? ""}`;
    if (seen.has(key)) break;
    seen.add(key);

    const parent = engine.pages.find(
      (q) => dirname(q.sourcePath) === current!.parentPath && q.language === current!.language,
    );
    if (!parent) break;

    const parentPage = await engine.loadPage(parent.sourcePath).catch(() => null);
    const override = parentPage?.frontmatter.theme_config;
    if (override && typeof override === "object" && !Array.isArray(override)) {
      ancestorOverrides.push(override as Record<string, unknown>);
    }

    current = parent;
  }

  // Collected nearest-to-farthest; reverse so farthest applies first and
  // nearest overrides it, matching "closest ancestor wins".
  ancestorOverrides.reverse();

  const ownOverride = page.frontmatter.theme_config;
  const layers = [
    engine.themeConfig,
    ...ancestorOverrides,
    ...(ownOverride && typeof ownOverride === "object" && !Array.isArray(ownOverride)
      ? [ownOverride as Record<string, unknown>]
      : []),
  ];

  return Object.assign({}, ...layers);
}
