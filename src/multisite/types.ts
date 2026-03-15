/**
 * Multisite module types.
 */

import type { BootstrapResult } from "../cli/bootstrap.ts";
export type { SiteEntry, MultisiteConfig } from "../config/types.ts";

export interface InitializedSite {
  /** The resolved site entry from config/sites.yaml */
  entry: import("../config/types.ts").SiteEntry;
  /** The fully bootstrapped site context */
  ctx: BootstrapResult;
  /** Per-request handler (production or dev) */
  handler: (req: Request) => Promise<Response>;
  /** Dev mode only — trigger SSE live-reload for clients on this site */
  notify?: () => void;
  /** Dev mode only — clean up file watchers etc. */
  cleanup?: () => void;
}
