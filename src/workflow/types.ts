/**
 * Content workflow types — status, transitions, scheduling, and revisions.
 */

/** Content lifecycle status */
export type ContentStatus =
  | "draft"
  | "in_review"
  | "published"
  | "archived";

/** Status transition definition */
export interface StatusTransition {
  from: ContentStatus;
  to: ContentStatus;
  /** Required permission to perform this transition */
  permission: string;
}

/** All allowed transitions */
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
