/**
 * Submission manager — stores and retrieves contact form submissions.
 *
 * Submissions are stored as JSON files in data/submissions/{form}/{id}.json
 * (git-tracked alongside content — they are business records).
 *
 * File naming: {ISO-timestamp}_{id}.json for natural chronological sort.
 */

import { encodeHex } from "@std/encoding/hex";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import type { StorageAdapter } from "../storage/types.ts";

// === Types ===

export interface Submission {
  id: string;
  form: string;
  receivedAt: number; // Unix ms
  status: SubmissionStatus;
  fields: Record<string, string>;
  meta: SubmissionMeta;
}

export type SubmissionStatus = "new" | "read" | "archived";

export interface SubmissionMeta {
  /** Submitter IP (from X-Forwarded-For or request) */
  ip?: string;
  /** Accept-Language header value */
  language?: string;
  /** User-Agent header value */
  userAgent?: string;
}

export interface SubmissionManagerConfig {
  storage: StorageAdapter;
  /** Base directory for all submissions, e.g. "data/submissions" */
  submissionsDir: string;
}

export interface SubmissionManager {
  /** Save a new submission. Returns the created record. */
  create(form: string, fields: Record<string, string>, meta?: SubmissionMeta): Promise<Submission>;
  /** Get a single submission by form + id. */
  get(form: string, id: string): Promise<Submission | null>;
  /** List all submissions for a form, newest first. */
  list(form: string): Promise<Submission[]>;
  /** Update the status of a submission. */
  setStatus(form: string, id: string, status: SubmissionStatus): Promise<boolean>;
  /** Delete a submission permanently. */
  delete(form: string, id: string): Promise<boolean>;
  /** Count unread (status = "new") submissions across all forms, or for one form. */
  countNew(form?: string): Promise<number>;
}

// === Implementation ===

export function createSubmissionManager(config: SubmissionManagerConfig): SubmissionManager {
  const { storage, submissionsDir } = config;

  function dirFor(form: string): string {
    // Sanitise form name — only alphanumeric + hyphens
    const safe = form.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
    return `${submissionsDir}/${safe}`;
  }

  function fileFor(form: string, id: string, receivedAt: number): string {
    const ts = new Date(receivedAt).toISOString().replace(/[:.]/g, "-");
    return `${dirFor(form)}/${ts}_${id}.json`;
  }

  async function create(
    form: string,
    fields: Record<string, string>,
    meta: SubmissionMeta = {},
  ): Promise<Submission> {
    const id = await generateId();
    const receivedAt = Date.now();

    const submission: Submission = {
      id,
      form,
      receivedAt,
      status: "new",
      fields,
      meta,
    };

    const path = fileFor(form, id, receivedAt);
    await storage.write(path, JSON.stringify(submission, null, 2));

    return submission;
  }

  async function get(form: string, id: string): Promise<Submission | null> {
    try {
      const entries = await storage.list(dirFor(form));
      const entry = entries.find((e) => e.name.endsWith(`_${id}.json`));
      if (!entry) return null;
      const data = await storage.read(`${dirFor(form)}/${entry.name}`);
      return JSON.parse(new TextDecoder().decode(data)) as Submission;
    } catch {
      return null;
    }
  }

  async function list(form: string): Promise<Submission[]> {
    const submissions: Submission[] = [];
    try {
      const entries = await storage.list(dirFor(form));
      for (const entry of entries) {
        if (entry.isDirectory || !entry.name.endsWith(".json")) continue;
        try {
          const data = await storage.read(`${dirFor(form)}/${entry.name}`);
          submissions.push(JSON.parse(new TextDecoder().decode(data)) as Submission);
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Directory doesn't exist yet — no submissions
    }
    // Newest first (filenames sort chronologically, so reverse)
    return submissions.sort((a, b) => b.receivedAt - a.receivedAt);
  }

  async function setStatus(form: string, id: string, status: SubmissionStatus): Promise<boolean> {
    try {
      const entries = await storage.list(dirFor(form));
      const entry = entries.find((e) => e.name.endsWith(`_${id}.json`));
      if (!entry) return false;
      const path = `${dirFor(form)}/${entry.name}`;
      const data = await storage.read(path);
      const submission = JSON.parse(new TextDecoder().decode(data)) as Submission;
      submission.status = status;
      await storage.write(path, JSON.stringify(submission, null, 2));
      return true;
    } catch {
      return false;
    }
  }

  async function deleteSubmission(form: string, id: string): Promise<boolean> {
    try {
      const entries = await storage.list(dirFor(form));
      const entry = entries.find((e) => e.name.endsWith(`_${id}.json`));
      if (!entry) return false;
      await storage.delete(`${dirFor(form)}/${entry.name}`);
      return true;
    } catch {
      return false;
    }
  }

  async function countNew(form?: string): Promise<number> {
    if (form) {
      const items = await list(form);
      return items.filter((s) => s.status === "new").length;
    }
    // Count across all forms
    let total = 0;
    try {
      const formDirs = await storage.list(submissionsDir);
      for (const dir of formDirs) {
        if (!dir.isDirectory) continue;
        const items = await list(dir.name);
        total += items.filter((s) => s.status === "new").length;
      }
    } catch {
      // No submissions dir yet
    }
    return total;
  }

  return { create, get, list, setStatus, delete: deleteSubmission, countNew };
}

async function generateId(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return encodeHex(bytes);
}
