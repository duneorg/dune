/**
 * Content workflow types — status, transitions, scheduling, and revisions.
 */

/** A workflow stage identifier — built-in or custom */
export type ContentStatus = string;

/** The 4 built-in stage IDs */
export type BuiltinStatus = "draft" | "in_review" | "published" | "archived";

/** A single workflow stage definition */
export interface WorkflowStage {
  /** Unique identifier — used as the status value in frontmatter */
  id: string;
  /** Display label */
  label: string;
  /**
   * Badge color for admin UI.
   * Named colors: "amber" | "blue" | "green" | "gray" | "orange" | "teal" | "red" | "purple"
   * Hex values are also accepted (e.g. "#f59e0b").
   */
  color?: string;
  /**
   * When true, transitioning to this stage sets page.published = true.
   * When false/absent, sets page.published = false.
   */
  publish?: boolean;
  /**
   * Terminal stage — no transitions away from this stage are allowed unless
   * explicitly defined. Informational only; the engine uses the transitions array.
   */
  terminal?: boolean;
}

/** A single allowed transition between stages */
export interface WorkflowTransition {
  from: string;
  to: string;
  /** Human-readable label for the transition button */
  label?: string;
  /**
   * Roles that can perform this transition.
   * If omitted or empty, any authenticated user can perform it.
   * Valid values: "admin" | "editor" | "author"
   */
  roles?: string[];
}

/** Full workflow configuration */
export interface WorkflowConfig {
  stages: WorkflowStage[];
  transitions: WorkflowTransition[];
}

/**
 * @deprecated Use WorkflowTransition instead.
 * Kept for backward compatibility with code that references StatusTransition.
 */
export interface StatusTransition {
  from: ContentStatus;
  to: ContentStatus;
  /** Required permission to perform this transition */
  permission: string;
}

/** @deprecated Use WorkflowConfig.transitions instead. */
export const TRANSITIONS: StatusTransition[] = [
  { from: "draft", to: "in_review", permission: "pages.update" },
  { from: "draft", to: "published", permission: "pages.update" },
  { from: "in_review", to: "published", permission: "pages.update" },
  { from: "in_review", to: "draft", permission: "pages.update" },
  { from: "published", to: "archived", permission: "pages.update" },
  { from: "published", to: "draft", permission: "pages.update" },
  { from: "archived", to: "draft", permission: "pages.update" },
];

/** Scheduled action */
export interface ScheduledAction {
  /** Unique ID */
  id: string;
  /** Source path of the page */
  sourcePath: string;
  /** Action to perform */
  action: "publish" | "unpublish" | "archive";
  /** When to perform the action (epoch ms) */
  scheduledAt: number;
  /** When this was created */
  createdAt: number;
  /** Who scheduled it */
  createdBy?: string;
}

/** Content revision record */
export interface ContentRevision {
  /** Unique revision ID */
  id: string;
  /** Source path of the page */
  sourcePath: string;
  /** Revision number (sequential per page) */
  number: number;
  /** Complete page content at this revision */
  content: string;
  /** Frontmatter snapshot */
  frontmatter: Record<string, unknown>;
  /** Who made this change */
  author?: string;
  /** When this revision was created */
  createdAt: number;
  /** Description of what changed */
  message?: string;
}

/** Diff between two revisions */
export interface ContentDiff {
  /** Lines added */
  additions: number;
  /** Lines removed */
  deletions: number;
  /** Unified diff format */
  patch: string;
}

/** i18n translation status for a page */
export interface TranslationStatus {
  /** Source path */
  sourcePath: string;
  /** Default language content hash */
  defaultHash: string;
  /** Status per language */
  languages: Record<string, {
    exists: boolean;
    hash?: string;
    upToDate: boolean;
    lastUpdated?: number;
  }>;
}
