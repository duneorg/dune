/**
 * What `system.search` in the config tells the built-in search engine.
 *
 * `custom_fields`, `fields`, `highlight` and `excerpt_length` used to be
 * declared, validated and documented but never passed to the engine, so setting
 * them did nothing. Every place that builds the built-in engine goes through
 * here so they cannot drift apart again.
 *
 * @module
 */

import type { SearchEngineOptions } from "./engine.ts";
import type { SystemConfig } from "../config/system-config.ts";

/** The engine options that come from `system.search` (the rest come from the caller). */
export type ConfiguredSearchOptions = Pick<
  SearchEngineOptions,
  "customFields" | "fieldWeights" | "highlightMatches" | "excerptLength"
>;

/** Translate `system.search` into engine options; unset keys stay unset so the engine's defaults apply. */
export function searchOptionsFromConfig(search: SystemConfig["search"]): ConfiguredSearchOptions {
  if (!search) return {};
  const options: ConfiguredSearchOptions = {};
  if (search.custom_fields?.length) options.customFields = [...search.custom_fields];
  if (search.fields) {
    const weights: Record<string, number> = {};
    for (const [field, def] of Object.entries(search.fields)) {
      if (def && typeof def.weight === "number") weights[field] = def.weight;
    }
    if (Object.keys(weights).length > 0) options.fieldWeights = weights;
  }
  if (typeof search.highlight === "boolean") options.highlightMatches = search.highlight;
  if (typeof search.excerpt_length === "number") options.excerptLength = search.excerpt_length;
  return options;
}
