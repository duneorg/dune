/**
 * Custom (generic HTTP) CDN purge provider.
 *
 * POSTs a JSON body with the list of URLs to a user-configured purge endpoint.
 * Supports optional Authorization header via api_token.
 *
 * Uses the SSRF guard from src/security/ssrf.ts to prevent purge requests
 * from being weaponized to reach internal infrastructure.
 *
 * Body format: { "urls": ["https://..."] }
 */

import type { CdnProvider, CdnPurgeRequest } from "../types.ts";
import { safeFetch, SsrfBlockedError } from "../../security/ssrf.ts";

export interface CustomCdnConfig {
  purge_url: string;
  api_token?: string;
}

export function createCustomProvider(config: CustomCdnConfig): CdnProvider {
  return {
    name: "custom",

    async purge(req: CdnPurgeRequest): Promise<void> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (config.api_token) {
        headers["Authorization"] = `Bearer ${config.api_token}`;
      }

      const body = JSON.stringify({ urls: req.urls });

      // SSRF guard (via safeFetch): validates the configured purge URL, pins
      // the resolved IP against DNS rebinding, and forces manual redirects.
      let resp: Response;
      try {
        resp = await safeFetch(config.purge_url, { method: "POST", headers, body });
      } catch (err) {
        const msg = err instanceof SsrfBlockedError ? err.message : String(err);
        throw new Error(`CDN custom provider: SSRF guard blocked purge URL: ${msg}`);
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(
          `Custom CDN purge failed: HTTP ${resp.status}${text ? ` — ${text.slice(0, 300)}` : ""}`,
        );
      }

      await resp.body?.cancel();
    },
  };
}
