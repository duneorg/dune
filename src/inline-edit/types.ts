/**
 * Inline editing types.
 *
 * Server-side types for the Y.js-based real-time inline editing system
 * introduced in v0.16.  The client side lives in `@dune/core/ui/editable`.
 */

import type { StorageAdapter } from "../storage/types.ts";
import type { HistoryEngine } from "../history/engine.ts";

// ── Session ───────────────────────────────────────────────────────────────────

/** State for one active WebSocket client editing a document. */
export interface InlineEditClient {
  clientId: string;
  userId: string;
  name: string;
  /** Y.js awareness color (hex) assigned by the server. */
  color: string;
  socket: WebSocket;
}

/** In-memory state for one collaboratively-edited document. */
export interface InlineEditSession {
  /** Content path, e.g. "pages/about/default.md" */
  sourcePath: string;
  /** Serialised Y.js document state (binary, full snapshot + pending updates). */
  ydocState: Uint8Array;
  /** All currently connected clients. */
  clients: Map<string, InlineEditClient>;
  /** Timer handle for the auto-flush debounce. */
  flushTimer: ReturnType<typeof setTimeout> | undefined;
  /** Timestamp of last write activity, used for idle eviction. */
  lastActivity: number;
}

// ── Manager ───────────────────────────────────────────────────────────────────

/** Options for {@link createInlineEditManager}. */
export interface InlineEditManagerOptions {
  storage: StorageAdapter;
  history: HistoryEngine;
  /** Base data directory, e.g. "data" — ydoc state stored under {dataDir}/ydoc/. */
  dataDir: string;
  /** Content directory, e.g. "content". Must match config.system.content.dir. */
  contentDir: string;
  /** Auto-flush after this many ms of inactivity (default 120_000 = 2 min). */
  autoFlushMs?: number;
}

/** Public interface for the inline editing server manager. */
export interface InlineEditManager {
  /**
   * Handle an HTTP → WebSocket upgrade for a Y.js sync session.
   * Caller must have already authenticated the user.
   * Returns a 101 response on success, or 4xx on bad request.
   */
  handleUpgrade(req: Request, user: { id: string; name: string }): Response;

  /**
   * Flush the live Y.js document for `sourcePath` to a history revision
   * and write the committed Markdown back to the `.md` file.
   * This is the "Save" action triggered by the client.
   */
  commit(sourcePath: string, author: string): Promise<void>;

  /**
   * Patch one or more frontmatter fields on a content file.
   * Writes through the history engine (creates a revision) and patches the
   * `.md` file on disk.  Does not touch the Markdown body.
   */
  patchFields(
    sourcePath: string,
    fields: Record<string, unknown>,
    author: string,
  ): Promise<void>;
}
