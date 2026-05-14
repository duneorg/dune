/**
 * CDN provider factory.
 *
 * Reads the `cdn` block from site config and returns an appropriate CdnProvider
 * instance, or null when no provider is configured.
 *
 * Usage:
 *   const provider = createCdnProvider(config.site.cdn);
 *   if (provider) { ... }
 */

import type { CdnProvider } from "../types.ts";
import { createCloudflareProvider } from "./cloudflare.ts";
import { createFastlyProvider } from "./fastly.ts";
import { createBunnyProvider } from "./bunny.ts";
import { createCustomProvider } from "./custom.ts";

/**
 * CDN configuration block from site.yaml.
 * Matches the cdn? field added to SiteConfig in src/config/types.ts.
 */
export interface CdnConfig {
  provider?: "cloudflare" | "fastly" | "bunny" | "custom";
  /** Base URL of the site as seen by the CDN — used to build absolute purge URLs. */
  base_url?: string;
  cloudflare?: { zoneId: string; apiToken: string };
  fastly?: { serviceId: string; apiKey: string };
  bunny?: { apiKey: string; pullZoneId?: string };
  /** Custom provider: POSTs { urls: string[] } to purge_url. */
  custom?: { purge_url: string; api_token?: string };
}

/**
 * Create a CdnProvider from the given config block.
 * Returns null when no provider is configured or the required provider-specific
 * config is missing.
 */
export function createCdnProvider(config: CdnConfig | undefined): CdnProvider | null {
  if (!config || !config.provider) return null;

  switch (config.provider) {
    case "cloudflare": {
      if (!config.cloudflare?.zoneId || !config.cloudflare?.apiToken) {
        console.warn("[dune] cdn: cloudflare provider requires cloudflare.zoneId and cloudflare.apiToken");
        return null;
      }
      return createCloudflareProvider(config.cloudflare);
    }

    case "fastly": {
      if (!config.fastly?.serviceId || !config.fastly?.apiKey) {
        console.warn("[dune] cdn: fastly provider requires fastly.serviceId and fastly.apiKey");
        return null;
      }
      return createFastlyProvider(config.fastly);
    }

    case "bunny": {
      if (!config.bunny?.apiKey) {
        console.warn("[dune] cdn: bunny provider requires bunny.apiKey");
        return null;
      }
      return createBunnyProvider(config.bunny);
    }

    case "custom": {
      if (!config.custom?.purge_url) {
        console.warn("[dune] cdn: custom provider requires custom.purge_url");
        return null;
      }
      return createCustomProvider(config.custom);
    }

    default:
      console.warn(`[dune] cdn: unknown provider "${config.provider}"`);
      return null;
  }
}
