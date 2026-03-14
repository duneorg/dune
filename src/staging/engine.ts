/**
 * Staging engine — save content drafts and generate shareable preview tokens.
 *
 * A "staged" page is an unpublished draft stored alongside revision history.
 * Drafts are previewed publicly via a signed token URL without requiring
 * admin login, making it easy to share work-in-progress with stakeholders.
 *
 * Storage layout (all within runtimeDir):
 *   {runtimeDir}/staging/{encodedPath}.json   — one file per staged page
 *
 * Lifecycle:
 *   1. Editor edits a page in admin and clicks "Save Draft"
 *   2. Admin calls POST /admin/api/staging/:path  → {token, previewUrl}
 *   3. Editor shares previewUrl with reviewers
 *   4. Reviewers visit /__preview?path=...&token=... — sees rendered draft
 *   5. Editor clicks "Publish" → POST /admin/api/staging/:path/publish
 *   6. Draft is written to the live file and the staging record is deleted
 */

import type { StorageAdapter } from "../storage/types.ts";
import { encodeHex } from "@std/encoding/hex";

export interface StagedDraft {
  /** Source path of the page (e.g. "01.home/default.md") */
  sourcePath: string;
  /** Markdown / MDX / TSX content body */
  content: string;
  /** Frontmatter fields */
  frontmatter: Record<string, unknown>;
  /** Opaque hex token used to authenticate the preview URL */
  token: string;
  /** Unix ms timestamp when the draft was created/last updated */
  updatedAt: number;
  /** Admin username who created the draft */
  createdBy?: string;
}

export interface StagingEngineConfig {
  storage: StorageAdapter;
  /** Directory for staging files, e.g. ".dune/admin" */
  runtimeDir: string;
}

export interface StagingEngine {
  /**
   * Create or update a staged draft for a page.
   * Generates a new random token if no draft exists, preserves the token
   * on updates so existing preview URLs remain valid.
   */
  upsert(input: UpsertInput): Promise<StagedDraft>;
  /** Get the current draft for a page (null if none). */
  get(sourcePath: string): Promise<StagedDraft | null>;
  /** Delete a staged draft (discard). */
  discard(sourcePath: string): Promise<void>;
  /**
   * Verify that a token matches the stored draft for a page.
   * Returns the draft on success, null if token is wrong or draft missing.
   */
  verify(sourcePath: string, token: string): Promise<StagedDraft | null>;
}

export interface UpsertInput {
  sourcePath: string;
  content: string;
  frontmatter: Record<string, unknown>;
  createdBy?: string;
}

export function createStagingEngine(config: StagingEngineConfig): StagingEngine {
  const { storage, runtimeDir } = config;

  function stagingPath(sourcePath: string): string {
    const encoded = sourcePath.replace(/\//g, "__").replace(/\\/g, "__");
    return `${runtimeDir}/staging/${encoded}.json`;
  }

  async function readDraft(sourcePath: string): Promise<StagedDraft | null> {
    try {
      const text = await storage.readText(stagingPath(sourcePath));
      return JSON.parse(text) as StagedDraft;
    } catch {
      return null;
    }
  }

  async function writeDraft(draft: StagedDraft): Promise<void> {
    const path = stagingPath(draft.sourcePath);
    await storage.write(path, new TextEncoder().encode(JSON.stringify(draft, null, 2)));
  }

  return {
    async upsert(input: UpsertInput): Promise<StagedDraft> {
      // Preserve existing token so preview URLs remain valid after edits
      const existing = await readDraft(input.sourcePath);
      const token = existing?.token ?? encodeHex(crypto.getRandomValues(new Uint8Array(16)));

      const draft: StagedDraft = {
        sourcePath: input.sourcePath,
        content: input.content,
        frontmatter: input.frontmatter,
        token,
        updatedAt: Date.now(),
        createdBy: input.createdBy,
      };
      await writeDraft(draft);
      return draft;
    },

    get: readDraft,

    async discard(sourcePath: string): Promise<void> {
      try {
        await storage.delete(stagingPath(sourcePath));
      } catch {
        // Already gone — not an error
      }
    },

    async verify(sourcePath: string, token: string): Promise<StagedDraft | null> {
      const draft = await readDraft(sourcePath);
      if (!draft) return null;
      // Constant-time comparison to prevent timing attacks
      if (!timingSafeEqual(draft.token, token)) return null;
      return draft;
    },
  };
}

/** Constant-time string comparison to avoid timing side-channels. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
