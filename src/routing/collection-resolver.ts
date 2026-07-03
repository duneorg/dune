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
  return await resolveDefinition(page.frontmatter.collection, page, collections, engine);
}

/**
 * Load and enrich every entry of a page's `collections:` frontmatter map
 * (name → collection definition). Enables pages that show several
 * independent page lists — e.g. block-based landing pages. Returns
 * undefined when the page has no `collections:` map or no entry resolves.
 */
export async function resolveCollectionsForPage(
  page: Page,
  collections: CollectionEngine,
  engine: DuneEngine,
): Promise<Record<string, Collection> | undefined> {
  const defs = page.frontmatter.collections;
  if (!defs || typeof defs !== "object" || Array.isArray(defs)) return undefined;

  const resolved: Record<string, Collection> = {};
  for (const [name, def] of Object.entries(defs as Record<string, unknown>)) {
    if (!def || typeof def !== "object") continue;
    const collection = await resolveDefinition(
      def as Parameters<CollectionEngine["resolve"]>[0],
      page,
      collections,
      engine,
    );
    if (collection) resolved[name] = collection;
  }
  return Object.keys(resolved).length > 0 ? resolved : undefined;
}

async function resolveDefinition(
  collectionDef: Parameters<CollectionEngine["resolve"]>[0],
  page: Page,
  collections: CollectionEngine,
  engine: DuneEngine,
): Promise<Collection | undefined> {
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
