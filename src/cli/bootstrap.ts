/**
 * CLI bootstrap — shared setup logic for CLI commands.
 * Creates storage, loads config, registers format handlers, and creates the engine.
 */

import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { FormatRegistry } from "../content/formats/registry.ts";
import { MarkdownHandler } from "../content/formats/markdown.ts";
import { TsxHandler } from "../content/formats/tsx.ts";
import { createDuneEngine } from "../core/engine.ts";
import { createCollectionEngine } from "../collections/engine.ts";
import { createTaxonomyEngine } from "../taxonomy/engine.ts";
import { createSearchEngine } from "../search/engine.ts";
import { createHookRegistry } from "../hooks/registry.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { CollectionEngine } from "../collections/engine.ts";
import type { TaxonomyEngine } from "../taxonomy/engine.ts";
import type { SearchEngine } from "../search/engine.ts";
import type { HookRegistry } from "../hooks/types.ts";
import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";

export interface BootstrapResult {
  engine: DuneEngine;
  storage: StorageAdapter;
  config: DuneConfig;
  formats: FormatRegistry;
  collections: CollectionEngine;
  taxonomy: TaxonomyEngine;
  search: SearchEngine;
  hooks: HookRegistry;
}

export interface BootstrapOptions {
  debug?: boolean;
  buildSearch?: boolean;
}

/**
 * Bootstrap the full Dune engine from a root directory.
 */
export async function bootstrap(
  root: string,
  options: BootstrapOptions = {},
): Promise<BootstrapResult> {
  const { debug = false, buildSearch = false } = options;

  // 1. Storage
  const storage = createStorage({ rootDir: root });

  // 2. Config
  const config = await loadConfig({
    storage,
    rootDir: root,
    skipConfigTs: false,
  });

  if (debug) {
    config.system.debug = true;
  }

  // 3. Format handlers
  const formats = new FormatRegistry();
  formats.register(new MarkdownHandler());
  formats.register(new TsxHandler());

  // 4. Engine
  const engine = await createDuneEngine({
    storage,
    config,
    formats,
    storageRoot: root,
  });

  await engine.init();

  // 5. Hooks
  const hooks = createHookRegistry({ config, storage });
  await hooks.fire("onConfigLoaded", config);
  await hooks.fire("onStorageReady", storage);
  await hooks.fire("onContentIndexReady", engine.pages);

  // 6. Taxonomy engine
  const taxonomy = createTaxonomyEngine({
    pages: engine.pages,
    taxonomyMap: engine.taxonomyMap,
  });

  // 7. Collection engine
  const collections = createCollectionEngine({
    pages: engine.pages,
    taxonomyMap: engine.taxonomyMap,
    loadPage: engine.loadPage,
  });

  // 8. Search engine
  const search = createSearchEngine({
    pages: engine.pages,
    storage,
    contentDir: config.system.content.dir,
    formats,
  });

  if (buildSearch) {
    await search.build();
  }

  return { engine, storage, config, formats, collections, taxonomy, search, hooks };
}
