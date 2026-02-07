/**
 * dune build — Build content index + validate config.
 */

import { bootstrap } from "./bootstrap.ts";
import { validateConfig } from "../config/validator.ts";

export interface BuildOptions {
  debug?: boolean;
}

export async function buildCommand(root: string, options: BuildOptions = {}) {
  const { debug = false } = options;

  console.log("🏜️  Dune — building site...\n");

  const start = performance.now();

  // Bootstrap engine (builds index)
  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, config, search, taxonomy } = ctx;

  // Validate config
  console.log("  🔧 Validating configuration...");
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.log("  ⚠️  Config issues:");
    for (const err of errors) {
      console.log(`    ✗ ${err}`);
    }
  } else {
    console.log("  ✅ Configuration valid");
  }

  // Report
  console.log(`\n  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🏷️  ${taxonomy.names().length} taxonomies`);

  // List taxonomy counts
  for (const name of taxonomy.names()) {
    const values = taxonomy.values(name);
    const count = Object.keys(values).length;
    console.log(`     ${name}: ${count} values`);
  }

  // Check for errors
  const unpublished = engine.pages.filter((p) => !p.published).length;
  if (unpublished > 0) {
    console.log(`  📝 ${unpublished} unpublished pages`);
  }

  const elapsed = (performance.now() - start).toFixed(0);
  console.log(`\n  ✅ Build complete in ${elapsed}ms`);
}
