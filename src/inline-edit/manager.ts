/**
 * InlineEditManager — session lifecycle and WebSocket upgrade handler.
 *
 * One Y.Doc + Awareness pair lives in memory per actively-edited document.
 * Sessions are garbage-collected after 5 minutes of inactivity with no
 * connected clients.
 */

import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { join } from "@std/path";
import type { InlineEditManager, InlineEditManagerOptions, InlineEditSession, InlineEditClient } from "./types.ts";
import { loadYDoc, persistYDoc, deleteYDoc } from "./ydoc-manager.ts";
import { connectClient } from "./ws-server.ts";
import { commitDoc, patchFrontmatterFields, splitFile } from "./commit.ts";

// ── Security limits ────────────────────────────────────────────────────────────

const GC_INTERVAL_MS = 5 * 60 * 1000;  // 5 min
const SESSION_IDLE_TTL_MS = 5 * 60 * 1000;

let _gcHandle: ReturnType<typeof setInterval> | undefined;

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create an inline edit manager.
 *
 * @example
 * ```ts
 * const inlineEdit = createInlineEditManager({ storage, history, dataDir: "data" });
 * // in admin route:
 * return inlineEdit.handleUpgrade(req, { id: user.id, name: user.username });
 * ```
 */
export function createInlineEditManager(
  opts: InlineEditManagerOptions,
): InlineEditManager {
  const { storage, history, dataDir, contentDir } = opts;
  const autoFlushMs = opts.autoFlushMs ?? 120_000;

  /**
   * In-memory map of sourcePath → { doc, awareness, session }.
   */
  const sessions = new Map<
    string,
    { doc: Y.Doc; awareness: awarenessProtocol.Awareness; session: InlineEditSession }
  >();

  // ── Session access ───────────────────────────────────────────────────────────

  async function getOrCreateSession(
    sourcePath: string,
    contentDir: string,
  ): Promise<{ doc: Y.Doc; awareness: awarenessProtocol.Awareness; session: InlineEditSession }> {
    const existing = sessions.get(sourcePath);
    if (existing) return existing;

    // Load current body from the content file.
    let initialBody = "";
    try {
      const raw = await storage.readText(`${contentDir}/${sourcePath}`);
      initialBody = splitFile(raw).body;
    } catch { /* new or missing file */ }

    const doc = await loadYDoc(dataDir, sourcePath, initialBody, storage);
    const awareness = new awarenessProtocol.Awareness(doc);
    const session: InlineEditSession = {
      sourcePath,
      ydocState: new Uint8Array(),  // tracked via doc, not used directly
      clients: new Map(),
      flushTimer: undefined,
      lastActivity: Date.now(),
    };

    sessions.set(sourcePath, { doc, awareness, session });
    return { doc, awareness, session };
  }

  // ── Auto-flush callback ──────────────────────────────────────────────────────

  async function onFlush(sourcePath: string): Promise<void> {
    const entry = sessions.get(sourcePath);
    if (!entry) return;
    const { doc, session } = entry;

    try {
      // Only flush if anyone has connected (doc has content beyond seed).
      if (session.clients.size === 0) {
        // Persist Y.js state but don't commit to history on idle eviction.
        await persistYDoc(dataDir, sourcePath, doc, storage);
      }
    } catch { /* best-effort */ }
  }

  // ── GC ───────────────────────────────────────────────────────────────────────

  function startGc(): void {
    if (_gcHandle) return;
    _gcHandle = setInterval(() => {
      const now = Date.now();
      for (const [path, { session, doc }] of sessions) {
        if (
          session.clients.size === 0 &&
          now - session.lastActivity > SESSION_IDLE_TTL_MS
        ) {
          // Persist before evicting.
          persistYDoc(dataDir, path, doc, storage).catch(() => {});
          if (session.flushTimer !== undefined) {
            clearTimeout(session.flushTimer);
          }
          doc.destroy();
          sessions.delete(path);
        }
      }
    }, GC_INTERVAL_MS);
    if (typeof Deno !== "undefined") {
      // Don't keep the process alive just for GC.
      try { (_gcHandle as unknown as { unref?: () => void }).unref?.(); } catch { /* ignore */ }
    }
  }

  startGc();

  // ── Public API ───────────────────────────────────────────────────────────────

  return {
    handleUpgrade(req: Request, user: { id: string; name: string }): Response {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      // Origin check (CSWSH defence).
      const origin = req.headers.get("origin");
      if (origin) {
        try {
          const reqUrl = new URL(req.url);
          if (new URL(origin).host !== reqUrl.host) {
            return new Response("Cross-origin WebSocket rejected", { status: 403 });
          }
        } catch {
          return new Response("Cross-origin WebSocket rejected", { status: 403 });
        }
      }

      const url = new URL(req.url);
      const sourcePath = url.searchParams.get("path");
      if (!sourcePath) {
        return new Response("Missing ?path= parameter", { status: 400 });
      }
      // Path validation is the caller's responsibility (edit-ws.ts uses
      // validatePagePath before calling handleUpgrade).  Sanity-check only.

      const { socket, response } = Deno.upgradeWebSocket(req);

      // Session setup is async; we kick it off after the upgrade response is sent.
      socket.onopen = async () => {
        try {
          const { doc, awareness, session } = await getOrCreateSession(sourcePath, contentDir);

          const clientId = crypto.randomUUID();
          const client: InlineEditClient = {
            clientId,
            userId: user.id,
            name: user.name,
            color: "#3498db",  // will be overridden in connectClient
            socket,
          };

          connectClient({
            socket,
            doc,
            awareness,
            session,
            client,
            dataDir,
            storage,
            autoFlushMs,
            onFlush,
          });
        } catch (err) {
          console.error("[inline-edit] session setup error:", err);
          socket.close(1011, "Server error");
        }
      };

      return response;
    },

    async commit(sourcePath: string, author: string): Promise<void> {
      const entry = sessions.get(sourcePath);

      if (!entry) {
        // No active session — read file and record a no-op revision, or skip.
        return;
      }

      const { doc } = entry;
      await commitDoc({
        doc,
        sourcePath,
        author,
        storage,
        history,
        contentDir,
      });

      // Remove the Y.js binary after a successful commit — the `.md` file is
      // now the canonical state; the draft is cleared.
      await deleteYDoc(dataDir, sourcePath, storage);
    },

    async patchFields(
      sourcePath: string,
      fields: Record<string, unknown>,
      author: string,
    ): Promise<void> {
      await patchFrontmatterFields({
        sourcePath,
        fields,
        author,
        storage,
        history,
        contentDir,
      });
    },

    getPresence() {
      const result: import("./types.ts").DocumentPresence[] = [];
      for (const [sourcePath, { session }] of sessions) {
        if (session.clients.size === 0) continue;
        result.push({
          sourcePath,
          editors: [...session.clients.values()].map((c) => ({
            userId: c.userId,
            name: c.name,
            color: c.color,
          })),
        });
      }
      return result;
    },
  };
}
