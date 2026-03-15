/**
 * Real-Time Collaboration types.
 *
 * Wire protocol: JSON messages over a single WebSocket per client.
 * Doc IDs are page sourcePaths (e.g. "pages/about/default.md").
 * Collaboration operates on the page body only (content after frontmatter).
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { DuneEngine } from "../core/engine.ts";
import type { HistoryEngine } from "../history/engine.ts";
import type { AdminUser } from "../admin/types.ts";

// ── Operations (Quill Delta format) ──────────────────────────────────────────

/** Keep n characters unchanged. */
export interface RetainOp { retain: number }
/** Insert a string at the current position. */
export interface InsertOp { insert: string }
/** Delete n characters at the current position. */
export interface DeleteOp { delete: number }

export type Op = RetainOp | InsertOp | DeleteOp;
export type Delta = Op[];

// ── Wire messages ─────────────────────────────────────────────────────────────

/** Messages sent from client to server. */
export type ClientMsg =
  /** Join a document editing session. `rev` is the client's last known revision (0 for fresh join). */
  | { type: "join"; docId: string; rev: number }
  /** Submit an editing operation. */
  | { type: "op"; docId: string; rev: number; delta: Delta }
  /** Update cursor / selection position. */
  | { type: "cursor"; docId: string; index: number; length: number }
  /** Explicitly leave the document (optional — server handles disconnects too). */
  | { type: "leave"; docId: string };

/** Messages sent from server to client. */
export type ServerMsg =
  /** Sent in response to a successful "join". */
  | { type: "joined"; docId: string; rev: number; content: string; users: PresenceInfo[] }
  /** Broadcast of a confirmed operation to all clients except the author. */
  | { type: "op"; docId: string; rev: number; delta: Delta; authorId: string; authorName: string }
  /** Acknowledgement sent back to the op author with the server-assigned revision. */
  | { type: "ack"; docId: string; rev: number }
  /** Presence update (user joined, left, or moved cursor). */
  | { type: "presence"; docId: string; users: PresenceInfo[] }
  /** Auto-save completed. */
  | { type: "saved"; docId: string; rev: number }
  /** Protocol error. */
  | { type: "error"; code: string; message: string };

/** Presence information for one connected editor. */
export interface PresenceInfo {
  clientId: string;
  userId: string;
  username: string;
  name: string;
  /** Hex color assigned by the server for this editor's highlights. */
  color: string;
  /** Current cursor / selection, if set. */
  cursor?: { index: number; length: number };
}

// ── In-memory state ───────────────────────────────────────────────────────────

/** State for one connected WebSocket client. */
export interface ClientState {
  clientId: string;
  userId: string;
  username: string;
  name: string;
  color: string;
  socket: WebSocket;
  cursor?: { index: number; length: number };
}

/** In-memory state for one collaboratively-edited document. */
export interface CollabSessionState {
  docId: string;
  /** Current monotonically-increasing revision number. Starts at 0. */
  rev: number;
  /** Current body text (everything after the frontmatter separator). */
  content: string;
  /**
   * Recent operation history for OT (ring buffer, last MAX_HISTORY entries).
   * Used to transform late-arriving ops from clients that are a few revs behind.
   */
  history: Array<{ rev: number; delta: Delta; authorId: string }>;
  /** All currently connected clients. */
  clients: Map<string, ClientState>;
  /** Username of the user who made the most recent edit (for history attribution). */
  lastEditor: string;
  /** Timestamp of the last op, used for idle-session eviction. */
  lastActivity: number;
  /** Handle for the pending auto-save debounce timer. */
  saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** Which color slots [0..7] are currently in use. */
  usedColorSlots: Set<number>;
}

// ── CollabManager ─────────────────────────────────────────────────────────────

export interface CollabManagerOptions {
  storage: StorageAdapter;
  engine: DuneEngine;
  history?: HistoryEngine;
  /** Value of config.system.content.dir — used to build storage paths. */
  contentDir: string;
}

/** The CollabManager public interface exposed to the admin server. */
export interface CollabManager {
  /**
   * Handle an HTTP-to-WebSocket upgrade request.
   * Caller must have already authenticated the user.
   * Returns a 101 Switching Protocols response.
   * Returns a 400 Response if `docId` query param is missing.
   */
  handleUpgrade(req: Request, user: AdminUser): Response;
}

export type { AdminUser };
