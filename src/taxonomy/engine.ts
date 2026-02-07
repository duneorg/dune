/**
 * Taxonomy query engine — provides query API over the taxonomy reverse index.
 *
 * The taxonomy reverse index is built by index-builder.ts during content
 * scanning. This module provides a query layer on top of that data:
 *   - Find pages by single taxonomy value
 *   - Find pages matching multiple taxonomy values (AND)
 *   - Find pages matching any of multiple values (OR)
 *   - List all values for a taxonomy
 *   - List all taxonomies
 */

import type { PageIndex } from "../content/types.ts";
import type { TaxonomyMap } from "../content/index-builder.ts";

export interface TaxonomyEngineOptions {
  /** All page indexes */
  pages: PageIndex[];
  /** The taxonomy reverse index */
  taxonomyMap: TaxonomyMap;
}

export interface TaxonomyEngine {
  /**
   * Find pages tagged with a specific taxonomy value.
   * Returns PageIndex entries (lightweight, no page loading).
   */
  find(taxonomy: string, value: string): PageIndex[];

  /**
   * Find pages matching multiple taxonomy criteria (AND logic).
   * All specified taxonomy:value pairs must match.
   *
   * @example
   * ```ts
   * engine.findAll({ tag: "deno", category: "tutorials" });
   * ```
   */
  findAll(criteria: Record<string, string | string[]>): PageIndex[];

  /**
   * Find pages matching ANY of the specified values for a taxonomy (OR logic).
   *
   * @example
   * ```ts
   * engine.findAny("tag", ["deno", "fresh"]);
   * ```
   */
  findAny(taxonomy: string, values: string[]): PageIndex[];

  /**
   * Get all values for a taxonomy with page counts.
   *
   * @returns Map of value → count
   */
  values(taxonomy: string): Record<string, number>;

  /**
   * List all taxonomy names.
   */
  names(): string[];

  /**
   * Get the full taxonomy map (for serialization / API).
   */
  map(): TaxonomyMap;

  /**
   * Rebuild with new data (after content index changes).
   */
  rebuild(pages: PageIndex[], taxonomyMap: TaxonomyMap): void;
}

/**
 * Create a taxonomy query engine.
 */
export function createTaxonomyEngine(
  options: TaxonomyEngineOptions,
): TaxonomyEngine {
  let { pages, taxonomyMap } = options;

  // Build a lookup map: sourcePath → PageIndex
  let pageMap = new Map<string, PageIndex>();
  for (const p of pages) {
    pageMap.set(p.sourcePath, p);
  }

  function rebuildPageMap() {
    pageMap = new Map();
    for (const p of pages) {
      pageMap.set(p.sourcePath, p);
    }
  }

  function resolveSourcePaths(sourcePaths: string[]): PageIndex[] {
    const results: PageIndex[] = [];
    for (const sp of sourcePaths) {
      const page = pageMap.get(sp);
      if (page && page.published) {
        results.push(page);
      }
    }
    return results;
  }

  return {
    find(taxonomy: string, value: string): PageIndex[] {
      const values = taxonomyMap[taxonomy];
      if (!values) return [];
      const sourcePaths = values[value];
      if (!sourcePaths) return [];
      return resolveSourcePaths(sourcePaths);
    },

    findAll(criteria: Record<string, string | string[]>): PageIndex[] {
      // Start with all pages, progressively narrow
      let candidatePaths: Set<string> | null = null;

      for (const [taxonomy, valueOrValues] of Object.entries(criteria)) {
        const taxValues = taxonomyMap[taxonomy];
        if (!taxValues) return []; // Taxonomy doesn't exist → no matches

        const valuesToMatch = Array.isArray(valueOrValues)
          ? valueOrValues
          : [valueOrValues];

        // Collect pages matching any of the values for this taxonomy
        const matchingPaths = new Set<string>();
        for (const val of valuesToMatch) {
          const paths = taxValues[val];
          if (paths) {
            for (const p of paths) matchingPaths.add(p);
          }
        }

        if (candidatePaths === null) {
          candidatePaths = matchingPaths;
        } else {
          // Intersect with previous results (AND)
          const intersection = new Set<string>();
          for (const p of candidatePaths) {
            if (matchingPaths.has(p)) intersection.add(p);
          }
          candidatePaths = intersection;
        }

        if (candidatePaths.size === 0) return [];
      }

      return candidatePaths ? resolveSourcePaths([...candidatePaths]) : [];
    },

    findAny(taxonomy: string, values: string[]): PageIndex[] {
      const taxValues = taxonomyMap[taxonomy];
      if (!taxValues) return [];

      const seen = new Set<string>();
      const results: PageIndex[] = [];

      for (const val of values) {
        const paths = taxValues[val];
        if (!paths) continue;
        for (const sp of paths) {
          if (seen.has(sp)) continue;
          seen.add(sp);
          const page = pageMap.get(sp);
          if (page && page.published) {
            results.push(page);
          }
        }
      }

      return results;
    },

    values(taxonomy: string): Record<string, number> {
      const taxValues = taxonomyMap[taxonomy];
      if (!taxValues) return {};

      const counts: Record<string, number> = {};
      for (const [value, paths] of Object.entries(taxValues)) {
        // Count only published pages
        counts[value] = paths.filter((sp) => {
          const page = pageMap.get(sp);
          return page?.published ?? false;
        }).length;
      }
      return counts;
    },

    names(): string[] {
      return Object.keys(taxonomyMap);
    },

    map(): TaxonomyMap {
      return taxonomyMap;
    },

    rebuild(newPages: PageIndex[], newTaxonomyMap: TaxonomyMap): void {
      pages = newPages;
      taxonomyMap = newTaxonomyMap;
      rebuildPageMap();
    },
  };
}
