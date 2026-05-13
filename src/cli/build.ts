/**
 * dune build — Build content index + validate config.
 * dune build --static — Generate a fully static site in the output directory.
 */

import { bootstrap } from "./bootstrap.ts";
import { validateConfig } from "../config/validator.ts";
import { buildStatic } from "../ssg/builder.ts";
import type { SSGOptions } from "../ssg/types.ts";

export interface BuildOptions {
  debug?: boolean;
  /** When true, generate a fully static site (SSG mode). */
  static?: boolean;
  /** Output directory for static build (default: "dist"). */
  outDir?: string;
  /** Canonical base URL for sitemap and feeds (overrides config.site.url). */
  baseUrl?: string;
  /** Disable incremental mode — rebuild all pages regardless of content changes. */
  noIncremental?: boolean;
  /** Max concurrent page renders (default: 8). */
  concurrency?: number;
  /** Emit hybrid-mode routing config (_routes.json, _redirects, _headers). */
  hybrid?: boolean;
  /** Include draft / unpublished pages in the build. */
  includeDrafts?: boolean;
  /** Print each rendered route. */
  verbose?: boolean;
  /** Output machine-parseable JSON instead of human-readable text. */
  json?: boolean;
}

export async function buildCommand(root: string, options: BuildOptions = {}) {
  const { debug = false, json = false } = options;

  if (options.static) {
    await buildStaticCommand(root, options);
    return;
  }

  // ── Standard build (index + validate) ─────────────────────────────────────

  if (!json) console.log("🏜️  Dune — building site...\n");

  const start = performance.now();

  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, config, taxonomy } = ctx;

  if (!json) console.log("  🔧 Validating configuration...");
  const configErrors = validateConfig(config);

  const unpublished = engine.pages.filter((p) => !p.published).length;
  const elapsedMs = Math.round(performance.now() - start);

  if (json) {
    // Collect taxonomy summary
    const taxonomySummary: Record<string, number> = {};
    for (const name of taxonomy.names()) {
      taxonomySummary[name] = Object.keys(taxonomy.values(name)).length;
    }
    const output = {
      success: configErrors.length === 0,
      pagesIndexed: engine.pages.length,
      published: engine.pages.filter((p) => p.published).length,
      unpublished,
      taxonomies: taxonomySummary,
      configErrors,
      elapsedMs,
    };
    console.log(JSON.stringify(output, null, 2));
    if (configErrors.length > 0) Deno.exit(1);
    return;
  }

  if (configErrors.length > 0) {
    console.log("  ⚠️  Config issues:");
    for (const err of configErrors) console.log(`    ✗ ${err}`);
  } else {
    console.log("  ✅ Configuration valid");
  }

  console.log(`\n  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🏷️  ${taxonomy.names().length} taxonomies`);
  for (const name of taxonomy.names()) {
    const count = Object.keys(taxonomy.values(name)).length;
    console.log(`     ${name}: ${count} values`);
  }

  if (unpublished > 0) console.log(`  📝 ${unpublished} unpublished pages`);

  console.log(`\n  ✅ Build complete in ${elapsedMs}ms`);
}

// ─── Static build ─────────────────────────────────────────────────────────────

async function buildStaticCommand(root: string, options: BuildOptions): Promise<void> {
  const { debug = false, json = false } = options;
  const outDir = options.outDir ?? "dist";
  const concurrency = options.concurrency ?? 8;
  const incremental = !options.noIncremental;
  const hybrid = options.hybrid ?? false;
  const includeDrafts = options.includeDrafts ?? false;
  const verbose = (options.verbose ?? debug) && !json;

  if (!json) {
    console.log(`🏜️  Dune — building static site → ${outDir}/\n`);
    if (incremental) console.log("  📦 Incremental mode active (use --no-incremental to force full rebuild)\n");
  }

  const bootstrapStart = performance.now();
  const ctx = await bootstrap(root, { debug, buildSearch: true });
  if (!json) {
    console.log(
      `  📄 ${ctx.engine.pages.length} pages indexed in ${
        Math.round(performance.now() - bootstrapStart)
      }ms`,
    );
  }

  const ssgOpts: SSGOptions = {
    outDir,
    baseUrl: options.baseUrl,
    incremental,
    concurrency,
    hybrid,
    includeDrafts,
    verbose,
  };

  const result = await buildStatic(root, ctx, ssgOpts);

  if (json) {
    const output = {
      success: result.errors.length === 0,
      outDir,
      pagesRendered: result.pagesRendered,
      pagesSkipped: result.pagesSkipped,
      assetsWritten: result.assetsWritten,
      hybrid,
      errors: result.errors,
      elapsedMs: result.elapsed,
    };
    console.log(JSON.stringify(output, null, 2));
    if (result.errors.length > 0) Deno.exit(1);
    return;
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  console.log(`\n  ✅ Static build complete in ${result.elapsed}ms`);
  console.log(`     Pages rendered : ${result.pagesRendered}`);
  if (result.pagesSkipped > 0) {
    console.log(`     Pages skipped  : ${result.pagesSkipped} (unchanged)`);
  }
  if (result.assetsWritten > 0) {
    console.log(`     Assets copied  : ${result.assetsWritten}`);
  }
  if (result.errors.length > 0) {
    console.log(`\n  ⚠️  ${result.errors.length} page(s) failed to render:`);
    for (const { route, error } of result.errors) {
      console.log(`     ✗ ${route}: ${error}`);
    }
    Deno.exit(1);
  }

  if (hybrid) {
    console.log(`\n  🔀 Hybrid config written:`);
    console.log(`     ${outDir}/_routes.json   (Cloudflare Pages)`);
    console.log(`     ${outDir}/_redirects     (Netlify)`);
    console.log(`     ${outDir}/_headers       (security headers)`);
  }

  console.log(`\n  📁 Output: ${outDir}/`);
}
