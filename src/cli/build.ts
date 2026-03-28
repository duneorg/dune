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
}

export async function buildCommand(root: string, options: BuildOptions = {}) {
  const { debug = false } = options;

  if (options.static) {
    await buildStaticCommand(root, options);
    return;
  }

  // ── Standard build (index + validate) ─────────────────────────────────────

  console.log("🏜️  Dune — building site...\n");

  const start = performance.now();

  const ctx = await bootstrap(root, { debug, buildSearch: true });
  const { engine, config, taxonomy } = ctx;

  console.log("  🔧 Validating configuration...");
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.log("  ⚠️  Config issues:");
    for (const err of errors) console.log(`    ✗ ${err}`);
  } else {
    console.log("  ✅ Configuration valid");
  }

  console.log(`\n  📄 ${engine.pages.length} pages indexed`);
  console.log(`  🏷️  ${taxonomy.names().length} taxonomies`);
  for (const name of taxonomy.names()) {
    const count = Object.keys(taxonomy.values(name)).length;
    console.log(`     ${name}: ${count} values`);
  }

  const unpublished = engine.pages.filter((p) => !p.published).length;
  if (unpublished > 0) console.log(`  📝 ${unpublished} unpublished pages`);

  const elapsed = (performance.now() - start).toFixed(0);
  console.log(`\n  ✅ Build complete in ${elapsed}ms`);
}

// ─── Static build ─────────────────────────────────────────────────────────────

async function buildStaticCommand(root: string, options: BuildOptions): Promise<void> {
  const { debug = false } = options;
  const outDir = options.outDir ?? "dist";
  const concurrency = options.concurrency ?? 8;
  const incremental = !options.noIncremental;
  const hybrid = options.hybrid ?? false;
  const includeDrafts = options.includeDrafts ?? false;
  const verbose = options.verbose ?? debug;

  console.log(`🏜️  Dune — building static site → ${outDir}/\n`);
  if (incremental) console.log("  📦 Incremental mode active (use --no-incremental to force full rebuild)\n");

  const bootstrapStart = performance.now();
  const ctx = await bootstrap(root, { debug, buildSearch: true });
  console.log(
    `  📄 ${ctx.engine.pages.length} pages indexed in ${
      Math.round(performance.now() - bootstrapStart)
    }ms`,
  );

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
