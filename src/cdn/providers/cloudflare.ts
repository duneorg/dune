/**
 * Cloudflare Cache Purge provider.
 *
 * Uses the Cloudflare Cache API to purge specific URLs or cache tags.
 * Endpoint: POST https://api.cloudflare.com/client/v4/zones/{zoneId}/purge_cache
 * Auth: Authorization: Bearer {apiToken}
 *
 * Cloudflare accepts up to 30 URLs per purge_cache request; the CdnManager
 * handles batching above that limit.
 */

import type { CdnProvider, CdnPurgeRequest } from "../types.ts";

export interface CloudflareConfig {
  zoneId: string;
  apiToken: string;
}

export function createCloudflareProvider(config: CloudflareConfig): CdnProvider {
  return {
    name: "cloudflare",

    async purge(req: CdnPurgeRequest): Promise<void> {
      const endpoint = `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/purge_cache`;

      // Prefer tag-based purge when tags are present
      const body: Record<string, unknown> = req.tags && req.tags.length > 0
        ? { tags: req.tags }
        : { files: req.urls };

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        redirect: "manual",
      });

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
          `Cloudflare purge failed: HTTP ${resp.status}${text ? ` — ${text.slice(0, 300)}` : ""}`,
        );
      }

      await resp.body?.cancel();
    },
  };
}
