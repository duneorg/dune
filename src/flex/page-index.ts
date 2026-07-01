/**
 * Shared Flex Object → synthetic PageIndex adapter.
 *
 * Both the search engine and the collections engine surface Flex Object
 * records through the page pipeline by mapping each record to a synthetic
 * {@link PageIndex}. These two mappings previously diverged (different
 * `template`, `published`, `mtime`, and `depth` values for the same record),
 * which meant search and collection filtering could disagree about the same
 * flex record. This module is the single source of truth for that mapping.
 *
 * The synthetic route is `/flex/{type}/{id}`, which the public routing layer
 * maps to a theme template at `themes/{theme}/templates/flex/{type}.tsx`.
 */

import type { ContentFormat, PageIndex } from "../content/types.ts";

/** Normalized input for {@link flexRecordToPageIndex}. */
export interface FlexPageIndexInput {
  /** Record id (used in the synthetic route and as the index hash). */
  id: string;
  /** Flex type name (schema key). */
  type: string;
  /** Record field values. May include `_`-prefixed metadata. */
  fields: Record<string, unknown>;
  /** Creation timestamp (epoch ms). Falls back to `fields._createdAt`. */
  createdAt?: number;
  /** Last-updated timestamp (epoch ms). Falls back to `fields._updatedAt`. */
  updatedAt?: number;
}

function numericField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Convert a Flex Object record into a synthetic {@link PageIndex} so it can
 * flow through the shared content filtering, ordering, and pagination pipeline.
 */
export function flexRecordToPageIndex(input: FlexPageIndexInput): PageIndex {
  const { id, type, fields } = input;

  // Prefer name > title > id as the human-readable label.
  const title = String((fields.name ?? fields.title ?? id) as string);

  const createdAt = input.createdAt ?? numericField(fields._createdAt);
  const updatedAt = input.updatedAt ?? numericField(fields._updatedAt);
  const date = createdAt ? new Date(createdAt).toISOString().split("T")[0] : null;

  return {
    sourcePath: `flex-objects/${type}/${id}.yaml`,
    route: `/flex/${type}/${id}`,
    language: "en",
    format: "md" as ContentFormat,
    template: `flex/${type}`,
    title,
    navTitle: title,
    date,
    // Treat records without an explicit `published` field as published.
    published: fields.published !== false,
    status: "published",
    visible: true,
    routable: true,
    isModule: false,
    order: 0,
    depth: 0,
    parentPath: null,
    taxonomy: {},
    mtime: Number(updatedAt ?? 0),
    hash: id,
  };
}
