/**
 * What a plugin gets to work with once the site is up: `MountApi.runtime`.
 *
 * It is the curated slice of the booted site that first-party plugins
 * actually use, and nothing else. `BootstrapResult` has about thirty fields,
 * most of them core's own wiring (the format registry, the image handler, the
 * HMAC key, the capability registry that resolves slots). Freezing that type
 * would freeze all of it, so a plugin is handed this narrower object and the
 * rest stays free to change.
 *
 * Everything on it is read-only. `jobs` is a getter because the job scheduler
 * is created per serving process, after `mount()`: read it lazily.
 *
 * @module
 */

import type { DuneEngine } from "../core/engine.ts";
import type { DuneConfig } from "../config/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { SearchManager } from "../search/manager.ts";
import type { HookRegistry } from "../hooks/types.ts";
import type { ContentApi } from "../content/api.ts";
import type { HistoryEngine } from "../history/engine.ts";
import type { FlexEngine } from "../flex/engine.ts";
import type { MetricsCollector } from "../metrics/mod.ts";
import type { SubmissionManager } from "../forms/submissions.ts";
import type { SectionRegistry } from "../sections/registry.ts";
import type { DuneAuthSystem } from "../auth/authz.ts";
import type { JobScheduler } from "../jobs/mod.ts";
import type { BootstrapResult } from "../runtime/bootstrap.ts";

/** The booted site, as a plugin sees it. See the module documentation. */
export interface PluginRuntime {
  /** The content engine: pages, routes, themes, rebuilds. */
  readonly engine: DuneEngine;
  /** The loaded site configuration. */
  readonly config: DuneConfig;
  /** Site storage (the site root, not only the content directory). */
  readonly storage: StorageAdapter;
  /** Search across the content index. */
  readonly search: SearchManager;
  /** The hook registry: fire the page events when you write a page. */
  readonly hooks: HookRegistry;
  /** Content query API (`pages()`, `page()`, `search()`, `taxonomy()`). */
  readonly contentApi: ContentApi;
  /** Revision history. */
  readonly history: HistoryEngine;
  /** Flex Objects. */
  readonly flexEngine: FlexEngine;
  /** In-process performance metrics. */
  readonly metrics: MetricsCollector;
  /** Public form submissions (core writes them, an admin manages them). */
  readonly submissions: SubmissionManager;
  /** The page-builder section registry the renderer uses. */
  readonly sections: SectionRegistry;
  /** The authorisation system; absent when authz is not enabled. */
  readonly authz?: DuneAuthSystem;
  /**
   * The job scheduler of the serving process; `undefined` until `dune serve`
   * starts it, which happens after `mount()`. This is a getter: read
   * `runtime.jobs` when you need it, not in `mount()` itself. Destructuring it
   * (`const { jobs } = runtime`) captures `undefined` for good.
   */
  readonly jobs?: JobScheduler;
}

/**
 * Build the runtime a plugin sees from core's full bootstrap result.
 *
 * Core-internal: not exported from `@dune/core/plugin-api`, so the frozen
 * contract is the `PluginRuntime` type and not how core builds one. The object
 * is frozen (one instance is shared by every plugin); the `jobs` accessor
 * stays live.
 */
export function createPluginRuntime(boot: BootstrapResult): PluginRuntime {
  return Object.freeze({
    engine: boot.engine,
    config: boot.config,
    storage: boot.storage,
    search: boot.search,
    hooks: boot.hooks,
    contentApi: boot.contentApi,
    history: boot.history,
    flexEngine: boot.flexEngine,
    metrics: boot.metrics,
    submissions: boot.submissions,
    sections: boot.sections,
    authz: boot.authz,
    get jobs() {
      return boot.jobScheduler;
    },
  });
}
