/**
 * Collection engine — declarative page queries with filtering, sorting,
 * pagination, and chainable modifiers.
 *
 * Collections resolve against the content index (lightweight PageIndex
 * entries). Full Page objects are loaded lazily only when accessed.
 *
 * Two usage modes:
 *   1. Declarative (frontmatter) — collection definition in YAML
 *   2. Programmatic — engine.collection({ items: ..., filter: ... })
 */

import { dirname } from "@std/path";
import type {
  Collection,
  CollectionDefinition,
  CollectionSource,
  Page,
  PageIndex,
} from "../content/types.ts";
import type { TaxonomyMap } from "../content/index-builder.ts";

export interface CollectionEngineOptions {
  /** All page indexes */
  pages: PageIndex[];
  /** Taxonomy reverse index */
  taxonomyMap: TaxonomyMap;
  /** Function to load a full Page by source path */
  loadPage: (sourcePath: string) => Promise<Page>;
}

export interface CollectionEngine {
  /**
   * Resolve a collection from a declarative definition.
   * @param definition The collection query definition
   * @param contextPage The page that owns this collection (for @self.* sources)
   */
  resolve(
    definition: CollectionDefinition,
    contextPage: PageIndex,
  ): Promise<Collection>;

  /**
   * Query pages programmatically.
   */
  query(definition: CollectionDefinition): Promise<Collection>;

  /**
   * Rebuild with new data (after content index changes).
   */
  rebuild(pages: PageIndex[], taxonomyMap: TaxonomyMap): void;
}

/**
 * Create a collection engine.
 */
export function createCollectionEngine(
  options: CollectionEngineOptions,
): CollectionEngine {
  let { pages, taxonomyMap, loadPage } = options;

  function resolveSource(
    source: CollectionSource,
    contextPage: PageIndex,
  ): PageIndex[] {
    // Determine which source type is specified
    if ("@self.children" in source) {
      return getChildren(contextPage);
    }
    if ("@self.siblings" in source) {
      return getSiblings(contextPage);
    }
    if ("@self.modules" in source) {
      return getModules(contextPage);
    }
    if ("@self.descendants" in source) {
      return getDescendants(contextPage);
    }
    if ("@page.children" in source) {
      const targetRoute = (source as { "@page.children": string })["@page.children"];
      const target = findPageByRoute(targetRoute);
      return target ? getChildren(target) : [];
    }
    if ("@page.descendants" in source) {
      const targetRoute = (source as { "@page.descendants": string })["@page.descendants"];
      const target = findPageByRoute(targetRoute);
      return target ? getDescendants(target) : [];
    }
    if ("@taxonomy.category" in source) {
      const values = (source as { "@taxonomy.category": string | string[] })["@taxonomy.category"];
      return findByTaxonomy("category", values);
    }
    if ("@taxonomy.tag" in source) {
      const values = (source as { "@taxonomy.tag": string | string[] })["@taxonomy.tag"];
      return findByTaxonomy("tag", values);
    }
    if ("@taxonomy" in source) {
      const criteria = (source as { "@taxonomy": Record<string, string | string[]> })["@taxonomy"];
      return findByMultipleTaxonomies(criteria);
    }

    return [];
  }

  function getChildren(page: PageIndex): PageIndex[] {
    const myDir = dirname(page.sourcePath);
    return pages.filter((p) => {
      if (p.sourcePath === page.sourcePath) return false;
      const pDir = dirname(p.sourcePath);
      const pParent = dirname(pDir);
      return pParent === myDir && !p.isModule;
    });
  }

  function getSiblings(page: PageIndex): PageIndex[] {
    if (!page.parentPath) return [];
    return pages.filter((p) => {
      if (p.sourcePath === page.sourcePath) return false;
      return p.parentPath === page.parentPath && !p.isModule;
    });
  }

  function getModules(page: PageIndex): PageIndex[] {
    const myDir = dirname(page.sourcePath);
    return pages.filter((p) => {
      if (p.sourcePath === page.sourcePath) return false;
      const pDir = dirname(p.sourcePath);
      const pParent = dirname(pDir);
      return pParent === myDir && p.isModule;
    });
  }

  function getDescendants(page: PageIndex): PageIndex[] {
    const myDir = dirname(page.sourcePath);
    // All pages whose sourcePath directory starts with myDir/
    return pages.filter((p) => {
      if (p.sourcePath === page.sourcePath) return false;
      const pDir = dirname(p.sourcePath);
      return pDir.startsWith(myDir + "/") && !p.isModule;
    });
  }

  function findPageByRoute(route: string): PageIndex | undefined {
    const normalized = route.startsWith("/") ? route : "/" + route;
    return pages.find((p) =>
      p.route === normalized || p.route === route
    );
  }

  function findByTaxonomy(
    taxonomy: string,
    values: string | string[],
  ): PageIndex[] {
    const taxMap = taxonomyMap[taxonomy];
    if (!taxMap) return [];

    const valArray = Array.isArray(values) ? values : [values];
    const seen = new Set<string>();
    const results: PageIndex[] = [];

    for (const val of valArray) {
      const sourcePaths = taxMap[val];
      if (!sourcePaths) continue;
      for (const sp of sourcePaths) {
        if (seen.has(sp)) continue;
        seen.add(sp);
        const page = pages.find((p) => p.sourcePath === sp);
        if (page) results.push(page);
      }
    }

    return results;
  }

  function findByMultipleTaxonomies(
    criteria: Record<string, string | string[]>,
  ): PageIndex[] {
    let candidatePaths: Set<string> | null = null;

    for (const [taxonomy, values] of Object.entries(criteria)) {
      const taxMap = taxonomyMap[taxonomy];
      if (!taxMap) return [];

      const valArray = Array.isArray(values) ? values : [values];
      const matching = new Set<string>();

      for (const val of valArray) {
        const paths = taxMap[val];
        if (paths) {
          for (const p of paths) matching.add(p);
        }
      }

      if (candidatePaths === null) {
        candidatePaths = matching;
      } else {
        const intersection = new Set<string>();
        for (const p of candidatePaths) {
          if (matching.has(p)) intersection.add(p);
        }
        candidatePaths = intersection;
      }

      if (candidatePaths.size === 0) return [];
    }

    if (!candidatePaths) return [];
    return [...candidatePaths]
      .map((sp) => pages.find((p) => p.sourcePath === sp))
      .filter((p): p is PageIndex => p !== undefined);
  }

  function applyFilter(
    items: PageIndex[],
    filter: CollectionDefinition["filter"],
  ): PageIndex[] {
    if (!filter) return items;

    return items.filter((page) => {
      // Published filter
      if (filter.published !== undefined && page.published !== filter.published) {
        return false;
      }
      // Visible filter
      if (filter.visible !== undefined && page.visible !== filter.visible) {
        return false;
      }
      // Routable filter
      if (filter.routable !== undefined && page.routable !== filter.routable) {
        return false;
      }
      // Template filter
      if (filter.template) {
        const templates = Array.isArray(filter.template)
          ? filter.template
          : [filter.template];
        if (!templates.includes(page.template)) return false;
      }
      // Taxonomy filter
      if (filter.taxonomy) {
        for (const [taxName, taxValues] of Object.entries(filter.taxonomy)) {
          const pageValues = page.taxonomy[taxName];
          if (!pageValues) return false;

          const required = Array.isArray(taxValues) ? taxValues : [taxValues];
          const hasMatch = required.some((v) => pageValues.includes(v));
          if (!hasMatch) return false;
        }
      }
      return true;
    });
  }

  function applyOrder(
    items: PageIndex[],
    order: CollectionDefinition["order"],
  ): PageIndex[] {
    if (!order) return items;

    const sorted = [...items];
    const dir = order.dir === "asc" ? 1 : -1;

    sorted.sort((a, b) => {
      let result = 0;

      switch (order.by) {
        case "date": {
          const da = a.date ?? "";
          const db = b.date ?? "";
          result = da.localeCompare(db);
          break;
        }
        case "title":
          result = a.title.localeCompare(b.title);
          break;
        case "order":
          result = a.order - b.order;
          break;
        case "random":
          result = Math.random() - 0.5;
          break;
        default:
          // Custom field — try to compare as strings
          // Custom fields would need full Page objects; for now, use order
          result = a.order - b.order;
          break;
      }

      return result * dir;
    });

    return sorted;
  }

  function buildCollection(
    allItems: PageIndex[],
    definition: CollectionDefinition,
  ): Collection {
    // Apply default published filter
    let items = allItems.filter((p) => p.published);

    // Apply user filters
    items = applyFilter(items, definition.filter);

    // Apply ordering
    items = applyOrder(items, definition.order);

    const total = items.length;

    // Apply offset/limit
    const offset = definition.offset ?? 0;
    const limit = definition.limit ?? total;
    items = items.slice(offset, offset + limit);

    // Determine pagination
    let pageNum = 1;
    let pageSize = total;
    let totalPages = 1;

    if (definition.pagination) {
      pageSize = typeof definition.pagination === "object"
        ? definition.pagination.size
        : 10;
      totalPages = Math.ceil(total / pageSize);
      pageNum = Math.floor(offset / pageSize) + 1;
    }

    return createCollectionObject(items, total, pageNum, totalPages, loadPage);
  }

  return {
    async resolve(
      definition: CollectionDefinition,
      contextPage: PageIndex,
    ): Promise<Collection> {
      const sourceItems = resolveSource(definition.items, contextPage);
      return buildCollection(sourceItems, definition);
    },

    async query(definition: CollectionDefinition): Promise<Collection> {
      // For programmatic queries without a context page, resolve source
      // using a dummy context (only matters for @self.* sources)
      const dummyContext: PageIndex = {
        sourcePath: "",
        route: "/",
        format: "md",
        template: "default",
        title: "",
        date: null,
        published: true,
        visible: true,
        routable: true,
        isModule: false,
        order: 0,
        depth: 0,
        parentPath: null,
        taxonomy: {},
        mtime: 0,
        hash: "",
      };
      const sourceItems = resolveSource(definition.items, dummyContext);
      return buildCollection(sourceItems, definition);
    },

    rebuild(newPages: PageIndex[], newTaxonomyMap: TaxonomyMap): void {
      pages = newPages;
      taxonomyMap = newTaxonomyMap;
    },
  };
}

/**
 * Create a Collection object with chainable modifiers.
 */
function createCollectionObject(
  indexItems: PageIndex[],
  total: number,
  page: number,
  totalPages: number,
  loadPage: (sourcePath: string) => Promise<Page>,
): Collection {
  // Lazy page loading — items are resolved only when accessed
  let loadedItems: Page[] | null = null;

  const loadItems = async (): Promise<Page[]> => {
    if (loadedItems) return loadedItems;
    loadedItems = await Promise.all(
      indexItems.map((idx) => loadPage(idx.sourcePath)),
    );
    return loadedItems;
  };

  const collection: Collection = {
    get items(): Page[] {
      // Synchronous access — returns empty if not yet loaded.
      // Templates should use `await collection.items` pattern
      // or pre-load via the engine.
      if (loadedItems) return loadedItems;
      // Trigger load and return proxy
      loadItems();
      return loadedItems ?? ([] as Page[]);
    },
    total,
    page,
    pages: totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,

    order(by: string, dir: "asc" | "desc" = "desc"): Collection {
      const sorted = [...indexItems].sort((a, b) => {
        const mult = dir === "asc" ? 1 : -1;
        switch (by) {
          case "date":
            return ((a.date ?? "").localeCompare(b.date ?? "")) * mult;
          case "title":
            return a.title.localeCompare(b.title) * mult;
          case "order":
            return (a.order - b.order) * mult;
          default:
            return 0;
        }
      });
      return createCollectionObject(sorted, sorted.length, 1, 1, loadPage);
    },

    filter(fn: (page: Page) => boolean): Collection {
      // This requires loaded pages — create a filtered collection
      const filtered = loadedItems
        ? loadedItems.filter(fn)
        : [];
      const filteredIndexes = filtered.map((p) =>
        indexItems.find((idx) => idx.sourcePath === p.sourcePath)!
      ).filter(Boolean);
      return createCollectionObject(
        filteredIndexes,
        filteredIndexes.length,
        1,
        1,
        loadPage,
      );
    },

    slice(start: number, end?: number): Collection {
      const sliced = indexItems.slice(start, end);
      return createCollectionObject(sliced, sliced.length, 1, 1, loadPage);
    },

    paginate(size: number, pageNum: number = 1): Collection {
      const offset = (pageNum - 1) * size;
      const paged = indexItems.slice(offset, offset + size);
      const pages = Math.ceil(indexItems.length / size);
      return createCollectionObject(
        paged,
        indexItems.length,
        pageNum,
        pages,
        loadPage,
      );
    },
  };

  return collection;
}
