/**
 * CdnManager — orchestrates CDN cache invalidation after content rebuilds.
 *
 * Converts site-relative routes (e.g. "/blog/hello") to absolute URLs using a
 * configured base URL, then batches them into provider-safe chunk sizes to
 * avoid hitting per-request limits (e.g. Cloudflare's 30-URL cap).
 *
 * Usage:
 *   const manager = new CdnManager({ provider, baseUrl: "https://example.com" });
 *   await manager.purgeRoutes(["/blog/hello", "/"]);
 */

import type { CdnProvider } from "./types.ts";

export interface CdnManagerConfig {
  provider: CdnProvider;
  /** Base URL of the site, e.g. "https://example.com" (no trailing slash). */
  baseUrl: string;
  /**
   * Maximum URLs per purge request.
   * Cloudflare enforces a 30-URL limit; we default to that as a safe ceiling.
   * Default: 30
   */
  maxBatchSize?: number;
}

export class CdnManager {
  private readonly provider: CdnProvider;
  private readonly baseUrl: string;
  private readonly maxBatchSize: number;

  constructor(config: CdnManagerConfig) {
    this.provider = config.provider;
    this.baseUrl = config.baseUrl.replace(/\/+$/, ""); // strip trailing slash
    this.maxBatchSize = config.maxBatchSize ?? 30;
  }

  /**
   * Purge a list of site-relative routes (e.g. ["/blog/hello", "/"]).
   *
   * Routes are converted to absolute URLs using the configured baseUrl, then
   * sent to the provider in batches of at most maxBatchSize URLs per call.
   * Empty input is a no-op (no provider calls are made).
   */
  async purgeRoutes(routes: string[]): Promise<void> {
    if (routes.length === 0) return;

    const urls = routes.map((route) => {
      const normalized = route.startsWith("/") ? route : `/${route}`;
      return `${this.baseUrl}${normalized}`;
    });

    await this.sendBatched(urls);
  }

  /**
   * Purge all cached content — useful after a full site rebuild.
   *
   * Sends a single purge request with a wildcard-style empty URL list combined
   * with a special "purge all" signal. Because provider APIs differ in how they
   * express "purge everything", this sends the base URL "/" as the only URL,
   * which in most CDN configurations triggers a full zone flush.
   *
   * For Cloudflare, the admin should use zone-level purge_everything from the
   * dashboard or configure tag-based invalidation for full flushes.
   */
  async purgeAll(): Promise<void> {
    await this.provider.purge({ urls: [`${this.baseUrl}/`] });
  }

  /** Split urls into maxBatchSize chunks and issue sequential purge calls. */
  private async sendBatched(urls: string[]): Promise<void> {
    for (let i = 0; i < urls.length; i += this.maxBatchSize) {
      const batch = urls.slice(i, i + this.maxBatchSize);
      await this.provider.purge({ urls: batch });
    }
  }
}
