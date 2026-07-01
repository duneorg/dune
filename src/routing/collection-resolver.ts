import type { Collection, Page } from "../content/types.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { DuneEngine } from "../core/engine.ts";

/**
 * Load and enrich the collection declared on a page's frontmatter.
 * Returns undefined if the page has no collection, the page index is not
 * found, or the collection fails to resolve.
 */
export async function resolveCollectionForPage(
  page: Page,
  collections: CollectionEngine,
  engine: DuneEngine,
): Promise<Collection | undefined> {
  if (!page.frontmatter.collection) return undefined;

  const collectionDef = page.frontmatter.collection;
  const pageIndex = engine.pages.find((p) => p.sourcePath === page.sourcePath);
  if (!pageIndex) return undefined;

  const collection = await collections.resolve(
    collectionDef,
    pageIndex,
    page.frontmatter as Record<string, unknown>,
  );
  if (!collection) return undefined;

  if (typeof collection.load === "function") {
    await collection.load();
    // Pre-render HTML for items synchronously read in JSX templates.
    // Build per-request wrapper objects so we never mutate shared Page
    // objects from engine.pageCache.
    const enrichedItems = await Promise.all(
      collection.items.map(async (item) =>
        Object.assign({}, item as object, { _html: await item.html() }) as unknown as typeof item
      ),
    );
    return { ...collection, items: enrichedItems } as typeof collection;
  }

  return collection;
}
