/**
 * Page comments and editorial annotations for the admin panel.
 *
 * Comments are attached to pages and support threaded replies, @mention
 * notifications, and a resolve/unresolve workflow suitable for editorial
 * sign-off processes.
 *
 * Storage layout (inside admin.dataDir — git-tracked):
 *   data/comments/{encodedPath}.json   → { comments: PageComment[] }
 *   encodedPath: sourcePath with "/" → "__" and "." → "-dot-"
 *
 * Mention read-state (inside admin.runtimeDir — gitignored, machine-local):
 *   .dune/admin/mention-reads/{username}.json → { readIds: string[] }
 *
 * All public methods are async to allow future storage adapter swapping.
 */

import { join, dirname } from "@std/path";
import { encodeHex } from "@std/encoding/hex";
import type { AdminUser } from "./types.ts";

// === Types ===

/** A single comment on a page */
export interface PageComment {
  /** Unique hex ID */
  id: string;
  /** sourcePath of the page this comment belongs to */
  pageSourcePath: string;
  /** Display name of the commenter */
  author: string;
  /** Login username — used for ownership checks and @mention lookup */
  authorUsername: string;
  /** Markdown-compatible comment body */
  body: string;
  /** Creation time (Unix ms) */
  createdAt: number;
  /** Last-edit time (Unix ms) */
  updatedAt: number;
  /** Whether this comment thread is resolved */
  resolved: boolean;
  /** Username of whoever resolved the comment */
  resolvedBy?: string;
  /** Time the comment was resolved (Unix ms) */
  resolvedAt?: number;
  /** Parent comment ID — set for replies */
  parentId?: string;
  /** Usernames extracted from @mentions in the body */
  mentions?: string[];
}

/** Stored file shape for one page's comments */
interface CommentsFile {
  comments: PageComment[];
}

/** Mention read state persisted per user */
interface MentionReadState {
  readIds: string[];
}

/** Options for createCommentManager */
export interface CommentManagerOptions {
  /** admin.dataDir — git-tracked persistent storage */
  dataDir: string;
  /** admin.runtimeDir — ephemeral machine-local storage */
  runtimeDir: string;
}

/** Public API surface for the comment manager */
export interface CommentManager {
  /** List all comments for a page, sorted oldest-first */
  list(pageSourcePath: string): Promise<PageComment[]>;
  /** Fetch a single comment by ID */
  get(pageSourcePath: string, id: string): Promise<PageComment | null>;
  /** Create a new comment (or reply) */
  create(
    pageSourcePath: string,
    input: { body: string; parentId?: string },
    author: AdminUser,
  ): Promise<PageComment>;
  /** Edit the body of a comment */
  update(
    pageSourcePath: string,
    id: string,
    body: string,
  ): Promise<PageComment | null>;
  /** Delete a comment (returns true if found and deleted) */
  delete(pageSourcePath: string, id: string): Promise<boolean>;
  /** Mark a comment thread as resolved */
  resolve(
    pageSourcePath: string,
    id: string,
    resolverUsername: string,
  ): Promise<PageComment | null>;
  /**
   * List all comments that @mention the given username, with read state.
   * Scans every page's comment file — suitable for low-volume deployments.
   */
  listMentions(
    username: string,
  ): Promise<Array<{ comment: PageComment; read: boolean }>>;
  /** Mark specific comment IDs as read for a user */
  markRead(username: string, ids: string[]): Promise<void>;
}

// === Helpers ===

/** Encode a sourcePath to a safe filename component */
function encodePath(sourcePath: string): string {
  return sourcePath.replace(/\//g, "__").replace(/\./g, "-dot-");
}

/** Generate a short random hex ID */
async function generateId(): Promise<string> {
  return encodeHex(crypto.getRandomValues(new Uint8Array(6)));
}

/** Extract @mention usernames from a comment body */
function extractMentions(body: string): string[] {
  const seen = new Set<string>();
  const matches = body.matchAll(/\B@([a-zA-Z0-9_-]+)/g);
  for (const m of matches) {
    seen.add(m[1]);
  }
  return [...seen];
}

// === File I/O helpers ===

async function readCommentsFile(filePath: string): Promise<CommentsFile> {
  try {
    const raw = await Deno.readTextFile(filePath);
    return JSON.parse(raw) as CommentsFile;
  } catch {
    return { comments: [] };
  }
}

async function writeCommentsFile(
  filePath: string,
  data: CommentsFile,
): Promise<void> {
  await Deno.mkdir(dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, JSON.stringify(data, null, 2));
}

async function readMentionReadState(filePath: string): Promise<MentionReadState> {
  try {
    const raw = await Deno.readTextFile(filePath);
    return JSON.parse(raw) as MentionReadState;
  } catch {
    return { readIds: [] };
  }
}

async function writeMentionReadState(
  filePath: string,
  state: MentionReadState,
): Promise<void> {
  await Deno.mkdir(dirname(filePath), { recursive: true });
  await Deno.writeTextFile(filePath, JSON.stringify(state, null, 2));
}

// === Factory ===

/**
 * Create a CommentManager backed by flat JSON files.
 */
export function createCommentManager(
  options: CommentManagerOptions,
): CommentManager {
  const { dataDir, runtimeDir } = options;

  function commentsFilePath(pageSourcePath: string): string {
    return join(dataDir, "comments", `${encodePath(pageSourcePath)}.json`);
  }

  function mentionReadPath(username: string): string {
    return join(runtimeDir, "mention-reads", `${username}.json`);
  }

  return {
    async list(pageSourcePath: string): Promise<PageComment[]> {
      const file = await readCommentsFile(commentsFilePath(pageSourcePath));
      return file.comments.slice().sort((a, b) => a.createdAt - b.createdAt);
    },

    async get(pageSourcePath: string, id: string): Promise<PageComment | null> {
      const file = await readCommentsFile(commentsFilePath(pageSourcePath));
      return file.comments.find((c) => c.id === id) ?? null;
    },

    async create(
      pageSourcePath: string,
      input: { body: string; parentId?: string },
      author: AdminUser,
    ): Promise<PageComment> {
      const filePath = commentsFilePath(pageSourcePath);
      const file = await readCommentsFile(filePath);

      const now = Date.now();
      const comment: PageComment = {
        id: await generateId(),
        pageSourcePath,
        author: author.name || author.username,
        authorUsername: author.username,
        body: input.body,
        createdAt: now,
        updatedAt: now,
        resolved: false,
        mentions: extractMentions(input.body),
        ...(input.parentId ? { parentId: input.parentId } : {}),
      };

      file.comments.push(comment);
      await writeCommentsFile(filePath, file);
      return comment;
    },

    async update(
      pageSourcePath: string,
      id: string,
      body: string,
    ): Promise<PageComment | null> {
      const filePath = commentsFilePath(pageSourcePath);
      const file = await readCommentsFile(filePath);

      const idx = file.comments.findIndex((c) => c.id === id);
      if (idx === -1) return null;

      const updated: PageComment = {
        ...file.comments[idx],
        body,
        updatedAt: Date.now(),
        mentions: extractMentions(body),
      };
      file.comments[idx] = updated;
      await writeCommentsFile(filePath, file);
      return updated;
    },

    async delete(pageSourcePath: string, id: string): Promise<boolean> {
      const filePath = commentsFilePath(pageSourcePath);
      const file = await readCommentsFile(filePath);

      const before = file.comments.length;
      file.comments = file.comments.filter((c) => c.id !== id);
      if (file.comments.length === before) return false;

      await writeCommentsFile(filePath, file);
      return true;
    },

    async resolve(
      pageSourcePath: string,
      id: string,
      resolverUsername: string,
    ): Promise<PageComment | null> {
      const filePath = commentsFilePath(pageSourcePath);
      const file = await readCommentsFile(filePath);

      const idx = file.comments.findIndex((c) => c.id === id);
      if (idx === -1) return null;

      const now = Date.now();
      const resolved: PageComment = {
        ...file.comments[idx],
        resolved: true,
        resolvedBy: resolverUsername,
        resolvedAt: now,
        updatedAt: now,
      };
      file.comments[idx] = resolved;
      await writeCommentsFile(filePath, file);
      return resolved;
    },

    async listMentions(
      username: string,
    ): Promise<Array<{ comment: PageComment; read: boolean }>> {
      const commentsDir = join(dataDir, "comments");
      const readState = await readMentionReadState(mentionReadPath(username));
      const readSet = new Set(readState.readIds);
      const results: Array<{ comment: PageComment; read: boolean }> = [];

      // Scan all comment files
      try {
        for await (const entry of Deno.readDir(commentsDir)) {
          if (!entry.isFile || !entry.name.endsWith(".json")) continue;
          try {
            const raw = await Deno.readTextFile(join(commentsDir, entry.name));
            const file = JSON.parse(raw) as CommentsFile;
            for (const comment of file.comments) {
              if (comment.mentions?.includes(username)) {
                results.push({ comment, read: readSet.has(comment.id) });
              }
            }
          } catch {
            // Skip malformed files
          }
        }
      } catch {
        // Directory doesn't exist yet
      }

      // Sort newest mention first
      results.sort((a, b) => b.comment.createdAt - a.comment.createdAt);
      return results;
    },

    async markRead(username: string, ids: string[]): Promise<void> {
      const filePath = mentionReadPath(username);
      const state = await readMentionReadState(filePath);
      const readSet = new Set(state.readIds);
      for (const id of ids) readSet.add(id);
      await writeMentionReadState(filePath, { readIds: [...readSet] });
    },
  };
}
