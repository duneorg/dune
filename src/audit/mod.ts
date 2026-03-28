/**
 * Audit logging module.
 * Re-exports all public types and the AuditLogger class.
 */

export type {
  AuditActor,
  AuditTarget,
  AuditEventType,
  AuditEntry,
  AuditLogOptions,
  AuditQuery,
  AuditQueryResult,
} from "./types.ts";

export { AuditLogger } from "./logger.ts";
