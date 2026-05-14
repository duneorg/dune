/**
 * BunnyCDN Purge provider.
 *
 * Purges URLs via the BunnyCDN API.
 * Endpoint: POST https://api.bunny.net/purge?url={encodedUrl}&async=false
 * Auth: AccessKey: {apiKey} header
 *
 * Reference: https://docs.bunny.net/reference/pullzonepublic_purgecache
 */

import type { CdnProvider, CdnPurgeRequest } from "../types.ts";

export interface BunnyConfig {
  apiKey: string;
  /** Optional pull zone ID (currently unused in per-URL purge). */
  pullZoneId?: string;
}

export function createBunnyProvider(config: BunnyConfig): CdnProvider {
  return {
    name: "bunny",

    async purge(req: CdnPurgeRequest): Promise<void> {
      const errors: string[] = [];

      await Promise.all(
        req.urls.map(async (url) => {
          const endpoint = `https://api.bunny.net/purge?url=${encodeURIComponent(url)}&async=false`;

          const resp = await fetch(endpoint, {
            method: "POST",
            headers: {
              "AccessKey": config.apiKey,
            },
            redirect: "manual",
          });

          if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            errors.push(
              `BunnyCDN purge failed for ${url}: HTTP ${resp.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
            );
          } else {
            await resp.body?.cancel();
          }
        }),
      );

      if (errors.length > 0) {
        throw new Error(errors.join("\n"));
      }
    },
  };
}
