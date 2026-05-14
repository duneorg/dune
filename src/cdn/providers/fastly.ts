/**
 * Fastly Instant Purge provider.
 *
 * Uses per-URL purging via HTTP PURGE method for surgical invalidation.
 * Each URL is sent as a separate PURGE request with the Fastly-Key header.
 *
 * Reference: https://developer.fastly.com/reference/api/purging/
 */

import type { CdnProvider, CdnPurgeRequest } from "../types.ts";

export interface FastlyConfig {
  serviceId: string;
  apiKey: string;
}

export function createFastlyProvider(config: FastlyConfig): CdnProvider {
  return {
    name: "fastly",

    async purge(req: CdnPurgeRequest): Promise<void> {
      // Fastly per-URL purge: issue a PURGE request to each URL individually.
      // The Fastly-Key header authenticates the request; the service ID is not
      // used in per-URL purging but is kept in config for potential surrogate-key
      // or service-level purge operations.
      const errors: string[] = [];

      await Promise.all(
        req.urls.map(async (url) => {
          const resp = await fetch(url, {
            method: "PURGE",
            headers: {
              "Fastly-Key": config.apiKey,
            },
            redirect: "manual",
          });

          if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            errors.push(
              `Fastly purge failed for ${url}: HTTP ${resp.status}${text ? ` — ${text.slice(0, 200)}` : ""}`,
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
