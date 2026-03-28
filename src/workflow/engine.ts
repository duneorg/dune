/**
 * Workflow engine — manages content status transitions and queries.
 *
 * Supports configurable multi-stage workflows. When no WorkflowConfig is
 * provided, falls back to the built-in 4-stage default (backward-compatible).
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { PageIndex } from "../content/types.ts";
import type {
  ContentStatus,
  WorkflowConfig,
  WorkflowStage,
  WorkflowTransition,
} from "./types.ts";

export interface WorkflowEngineConfig {
  storage: StorageAdapter;
  /** Directory for workflow data */
  dataDir: string;
}

export interface WorkflowEngine {
  /** All configured stages */
  stages: WorkflowStage[];
  /** Get the effective status for a page (from frontmatter or default) */
  getStatus(page: PageIndex): ContentStatus;
  /** Check if a transition is valid, optionally scoped to a user role */
  canTransition(from: ContentStatus, to: ContentStatus, role?: string): boolean;
  /** Get allowed target statuses from a status, optionally filtered by role */
  allowedTransitions(from: ContentStatus, role?: string): ContentStatus[];
  /** Full transition objects from a status, optionally filtered by role */
  allowedTransitionObjects(from: ContentStatus, role?: string): WorkflowTransition[];
  /** Whether transitioning to `to` should set published=true on the page */
  setsPublished(to: ContentStatus): boolean;
  /** Find pages by status */
  findByStatus(pages: PageIndex[], status: ContentStatus): PageIndex[];
  /** Get status counts */
  statusCounts(pages: PageIndex[]): Record<string, number>;
}

// ── Default config (backward-compatible) ─────────────────────────────────────

const DEFAULT_STAGES: WorkflowStage[] = [
  { id: "draft", label: "Draft", color: "amber" },
  { id: "in_review", label: "In Review", color: "blue" },
  { id: "published", label: "Published", color: "green", publish: true },
  { id: "archived", label: "Archived", color: "gray", terminal: true },
];

const DEFAULT_TRANSITIONS: WorkflowTransition[] = [
  { from: "draft", to: "in_review", label: "Submit for Review" },
  { from: "draft", to: "published", label: "Publish" },
  { from: "in_review", to: "published", label: "Approve & Publish" },
  { from: "in_review", to: "draft", label: "Return to Draft" },
  { from: "published", to: "archived", label: "Archive" },
  { from: "published", to: "draft", label: "Unpublish" },
  { from: "archived", to: "draft", label: "Restore" },
];

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a workflow engine.
 *
 * @param _config  Storage/data-dir config (kept for API compatibility).
 * @param workflow Optional workflow stage+transition config. When omitted the
 *                 built-in 4-stage default is used.
 */
export function createWorkflowEngine(
  _config?: WorkflowEngineConfig,
  workflow?: WorkflowConfig,
): WorkflowEngine {
  const stages = workflow?.stages ?? DEFAULT_STAGES;
  const transitions = workflow?.transitions ?? DEFAULT_TRANSITIONS;

  // Build a fast Set of valid stage IDs for getStatus validation.
  const stageIds = new Set(stages.map((s) => s.id));

  // Build a Map from stage id → stage for O(1) lookup.
  const stageMap = new Map<string, WorkflowStage>(stages.map((s) => [s.id, s]));

  function filterByRole(
    list: WorkflowTransition[],
    role: string | undefined,
  ): WorkflowTransition[] {
    if (role === undefined) return list;
    return list.filter((t) => !t.roles || t.roles.length === 0 || t.roles.includes(role));
  }

  return {
    stages,

    getStatus(page: PageIndex): ContentStatus {
      if (page.status && stageIds.has(page.status as string)) {
        return page.status as string;
      }
      // Infer from published flag for pages without a recognised status.
      return page.published ? "published" : "draft";
    },

    canTransition(from: ContentStatus, to: ContentStatus, role?: string): boolean {
      const matching = transitions.filter((t) => t.from === from && t.to === to);
      return filterByRole(matching, role).length > 0;
    },

    allowedTransitions(from: ContentStatus, role?: string): ContentStatus[] {
      return this.allowedTransitionObjects(from, role).map((t) => t.to);
    },

    allowedTransitionObjects(from: ContentStatus, role?: string): WorkflowTransition[] {
      const fromTransitions = transitions.filter((t) => t.from === from);
      return filterByRole(fromTransitions, role);
    },

    setsPublished(to: ContentStatus): boolean {
      return stageMap.get(to)?.publish === true;
    },

    findByStatus(pages: PageIndex[], status: ContentStatus): PageIndex[] {
      return pages.filter((p) => this.getStatus(p) === status);
    },

    statusCounts(pages: PageIndex[]): Record<string, number> {
      const counts: Record<string, number> = {};
      // Initialise all known stages to 0.
      for (const s of stages) {
        counts[s.id] = 0;
      }
      for (const page of pages) {
        const status = this.getStatus(page);
        counts[status] = (counts[status] ?? 0) + 1;
      }
      return counts;
    },
  };
}
