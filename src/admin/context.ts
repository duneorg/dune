/**
 * Admin context singleton — initialized once at bootstrap, imported by route files.
 * Avoids threading all dependencies through Fresh context state.
 */

import type { DuneEngine } from "../core/engine.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { DuneConfig } from "../config/types.ts";
import type { AuthMiddleware } from "./auth/middleware.ts";
import type { UserManager } from "./auth/users.ts";
import type { SessionManager } from "./auth/sessions.ts";
import type { AuthProvider } from "./auth/provider.ts";
import type { WorkflowEngine } from "../workflow/engine.ts";
import type { Scheduler } from "../workflow/scheduler.ts";
import type { HistoryEngine } from "../history/engine.ts";
import type { SubmissionManager } from "./submissions.ts";
import type { FlexEngine } from "../flex/engine.ts";
import type { HookRegistry, AdminPageRegistration } from "../hooks/types.ts";
import type { StagingEngine } from "../staging/engine.ts";
import type { CommentManager } from "./comments.ts";
import type { CollabManager } from "../collab/mod.ts";
import type { ImageCache } from "../images/cache.ts";
import type { AuditLogger } from "../audit/mod.ts";
import type { MetricsCollector } from "../metrics/mod.ts";
import type { MachineTranslator } from "../mt/mod.ts";

export type { AdminPageRegistration };

export interface AdminContext {
  engine: DuneEngine;
  storage: StorageAdapter;
  config: DuneConfig;
  auth: AuthMiddleware;
  users: UserManager;
  sessions: SessionManager;
  /** Admin route prefix, e.g. "/admin" */
  prefix: string;
  authProvider?: AuthProvider;
  workflow?: WorkflowEngine;
  scheduler?: Scheduler;
  history?: HistoryEngine;
  submissions?: SubmissionManager;
  flex?: FlexEngine;
  hooks?: HookRegistry;
  staging?: StagingEngine;
  comments?: CommentManager;
  collab?: CollabManager;
  imageCache?: ImageCache;
  auditLogger?: AuditLogger;
  metrics?: MetricsCollector;
  mt?: MachineTranslator | null;
  /**
   * Plugin-contributed admin pages, collected at bootstrap.
   * The Fresh app registers these as programmatic routes after fsRoutes().
   */
  pluginPages?: AdminPageRegistration[];
}

let _ctx: AdminContext | null = null;

export function initAdminContext(ctx: AdminContext): void {
  _ctx = ctx;
}

export function getAdminContext(): AdminContext {
  if (!_ctx) throw new Error("Admin context not initialized");
  return _ctx;
}
