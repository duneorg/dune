/**
 * Audit logging type definitions.
 */

/** Actor performing the action */
export interface AuditActor {
  userId: string;
  username: string;
  name: string;
}

/** Target resource */
export interface AuditTarget {
  type: "page" | "user" | "config" | "plugin" | "theme" | "media" | "flex" | "form" | "system" | "comment";
  /** Human-readable identifier (sourcePath for pages, userId for users, etc.) */
  id?: string;
}

/** All audit event types */
export type AuditEventType =
  // Auth
  | "auth.login" | "auth.logout" | "auth.login_failed"
  | "auth.csrf_denied" | "auth.permission_denied"
  // Pages
  | "page.create" | "page.update" | "page.delete" | "page.publish" | "page.workflow"
  // Config
  | "config.update"
  // Users
  | "user.create" | "user.update" | "user.delete" | "user.password"
  // Media
  | "media.upload" | "media.delete"
  // Plugins
  | "plugin.config_update"
  // Flex
  | "flex.create" | "flex.update" | "flex.delete"
  // System
  | "system.rebuild" | "system.cache_purge";

/** A single audit log entry */
export interface AuditEntry {
  id: string;             // crypto.randomUUID()
  ts: string;             // ISO 8601
  event: AuditEventType;
  actor: AuditActor | null;   // null for system/unauthenticated actions
  ip: string | null;
  userAgent: string | null;
  target: AuditTarget | null;
  detail: Record<string, unknown>;  // event-specific extra info
  outcome: "success" | "failure";
}

/** Options for creating an AuditLogger */
export interface AuditLogOptions {
  /** Path to the JSONL log file (e.g. ".dune/admin/audit.log") */
  logFile: string;
  /** Maximum entries returned by query() (default: 1000) */
  maxQueryEntries?: number;
}

/** Query parameters for AuditLogger.query() */
export interface AuditQuery {
  limit?: number;
  offset?: number;
  event?: AuditEventType;
  actorId?: string;
  from?: string;    // ISO date string
  to?: string;      // ISO date string
  outcome?: "success" | "failure";
}

/** Result from AuditLogger.query() */
export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
}
