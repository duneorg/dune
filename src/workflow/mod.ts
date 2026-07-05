/**
 * Workflow module — barrel exports.
 *
 * @module
 */

export type {
  /** A workflow stage identifier — built-in or custom */
  ContentStatus,
  BuiltinStatus,
  WorkflowStage,
  WorkflowTransition,
  WorkflowConfig,
  /** @deprecated Use WorkflowTransition instead. Kept for backward compatibility. */
  StatusTransition,
  /** Scheduled action */
  ScheduledAction,
  /** Content revision record */
  ContentRevision,
  /** Diff between two revisions */
  ContentDiff,
  /** i18n translation status for a page */
  TranslationStatus,
} from "./types.ts";
export {
  /** @deprecated Use WorkflowConfig.transitions instead. */
  TRANSITIONS,
} from "./types.ts";
export {
  /** Create a workflow engine. */
  createWorkflowEngine,
} from "./engine.ts";
export type {
  /** Manages content status transitions and workflow queries. Obtain via {@link createWorkflowEngine}. */
  WorkflowEngine,
  /** Options for {@link createWorkflowEngine}. */
  WorkflowEngineConfig,
} from "./engine.ts";
export {
  /** Create a content scheduler. */
  createScheduler,
} from "./scheduler.ts";
export type {
  /** Schedules and executes time-based publish/unpublish/archive actions. Obtain via {@link createScheduler}. */
  Scheduler,
  /** Options for {@link createScheduler}. */
  SchedulerConfig,
} from "./scheduler.ts";
