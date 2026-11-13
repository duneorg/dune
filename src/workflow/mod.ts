/**
 * Workflow module — barrel exports.
 *
 * @module
 */

export type {
  BuiltinStatus,
  /** Diff between two revisions */
  ContentDiff,
  /** Content revision record */
  ContentRevision,
  /** A workflow stage identifier — built-in or custom */
  ContentStatus,
  /** Scheduled action */
  ScheduledAction,
  /** i18n translation status for a page */
  TranslationStatus,
  WorkflowConfig,
  WorkflowStage,
  WorkflowTransition,
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
