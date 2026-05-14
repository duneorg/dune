/**
 * CDN cache invalidation types.
 *
 * Providers implement CdnProvider to support surgical cache purging after
 * content rebuilds. The CdnManager orchestrates batched purge requests
 * and URL construction from site-relative routes.
 */

export interface CdnPurgeRequest {
  /** Absolute URLs to purge from the CDN edge cache. */
  urls: string[];
  /** Cache tags to purge (supported by Cloudflare and some other providers). */
  tags?: string[];
}

export interface CdnProvider {
  /** Human-readable provider name for logging. */
  name: string;
  /**
   * Purge the given URLs (and optionally tags) from the CDN edge cache.
   * Implementations should throw on unrecoverable errors so the manager
   * can log them, but should never swallow provider-level errors silently.
   */
  purge(req: CdnPurgeRequest): Promise<void>;
}
