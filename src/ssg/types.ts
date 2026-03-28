/**
 * SSG type definitions.
 */

/** Options controlling the static site build. */
export interface SSGOptions {
  /** Output directory relative to site root (default: "dist") */
  outDir: string;
  /**
   * Canonical base URL used in sitemap and feeds.
   * Overrides config.site.url when provided.
   */
  baseUrl?: string;
  /**
   * Incremental mode — skip pages whose source content has not changed
   * since the last build.  Requires a prior dist/.dune-build.json.
   * (default: true)
   */
  incremental: boolean;
  /** Maximum concurrent page renders (default: 8) */
  concurrency: number;
  /**
   * Hybrid mode — emit a _routes.json (Cloudflare Pages) and _headers file
   * so API and admin routes are forwarded to a running server while all
   * other paths are served statically.
   * (default: false)
   */
  hybrid: boolean;
  /** Include draft / unpublished pages in the build (default: false) */
  includeDrafts: boolean;
  /** Print each rendered route (default: false) */
  verbose: boolean;
}

/** Result returned by buildStatic(). */
export interface SSGResult {
  pagesRendered: number;
  /** Pages skipped due to unchanged content in incremental mode. */
  pagesSkipped: number;
  /** Number of static asset files written. */
  assetsWritten: number;
  /** Routes that failed to render. */
  errors: Array<{ route: string; error: string }>;
  /** Wall-clock build time in milliseconds. */
  elapsed: number;
}
