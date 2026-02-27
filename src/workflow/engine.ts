/**
 * Workflow engine — manages content status transitions and queries.
 *
 * Enforces valid status transitions and provides query methods
 * for finding content by status.
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { PageIndex } from "../content/types.ts";
import type { ContentStatus, StatusTransition, TRANSITIONS } from "./types.ts";

export interface WorkflowEngineConfig {
  storage: StorageAdapter;
  /** Directory for workflow data */
  dataDir: string;
}

export interface WorkflowEngine {
  /** Get the effective status for a page (from frontmatter or default) */
  getStatus(page: PageIndex): ContentStatus;
  /** Check if a transition is valid */
  canTransition(from: ContentStatus, to: ContentStatus): boolean;
  /** Get allowed transitions from a status */
  allowedTransitions(from: ContentStatus): ContentStatus[];
  /** Find pages by status */
  findByStatus(pages: PageIndex[], status: ContentStatus): PageIndex[];
  /** Get status counts */
  statusCounts(pages: PageIndex[]): Record<ContentStatus, number>;
}

/**
 * Create a workflow engine.
 */
export function createWorkflowEngine(
  config: WorkflowEngineConfig,
  transitions: StatusTransition[] = [...defaultTransitions()],
): WorkflowEngine {
  return {
    getStatus(page: PageIndex): ContentStatus {
      // PageIndex.status is already typed as the full union — no cast needed.
      if (page.status && isValidStatus(page.status)) {
        return page.status;
      }
      // Infer from published flag for pages without an explicit status.
      return page.published ? "published" : "draft";
    },

    canTransition(from: ContentStatus, to: ContentStatus): boolean {
      return transitions.some((t) => t.from === from && t.to === to);
    },

    allowedTransitions(from: ContentStatus): ContentStatus[] {
      return transitions
        .filter((t) => t.from === from)
        .map((t) => t.to);
    },

    findByStatus(pages: PageIndex[], status: ContentStatus): PageIndex[] {
      return pages.filter((p) => this.getStatus(p) === status);
    },

    statusCounts(pages: PageIndex[]): Record<ContentStatus, number> {
      const counts: Record<ContentStatus, number> = {
        draft: 0,
        in_review: 0,
        published: 0,
        archived: 0,
      };
      for (const page of pages) {
        const status = this.getStatus(page);
        counts[status]++;
      }
      return counts;
    },
  };
}

function isValidStatus(s: unknown): s is ContentStatus {
  return typeof s === "string" &&
    ["draft", "in_review", "published", "archived"].includes(s);
}

function defaultTransitions(): StatusTransition[] {
  return [
    { from: "draft", to: "in_review", permission: "pages.update" },
    { from: "draft", to: "published", permission: "pages.update" },
    { from: "in_review", to: "published", permission: "pages.update" },
    { from: "in_review", to: "draft", permission: "pages.update" },
    { from: "published", to: "archived", permission: "pages.update" },
    { from: "published", to: "draft", permission: "pages.update" },
    { from: "archived", to: "draft", permission: "pages.update" },
  ];
}
