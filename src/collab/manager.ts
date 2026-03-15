/**
 * CollabManager — WebSocket lifecycle and session orchestration.
 *
 * Responsibilities:
 *   - HTTP → WebSocket upgrade (GET /admin/collab/ws?docId=...)
 *   - Load document body from storage on first join
 *   - Apply OT to incoming operations and broadcast to peers
 *   - Debounced auto-save (3s idle or last client leaves)
 *   - Idle session eviction (5-min GC loop)
 *   - Presence broadcasts on join / leave / cursor move
 */

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";
import type {
  CollabManager,
  CollabManagerOptions,
  CollabSessionState,
  ClientState,
  ClientMsg,
  AdminUser,
} from "./types.ts";
import {
  createCollabSession,
  addClient,
  removeClient,
  applyClientOp,
  getPresence,
  sendToClient,
  broadcastToSession,
  assignColorSlot,
  PRESENCE_COLORS,
  SAVE_DELAY_MS,
} from "./session.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the body text from a raw content file.
 * Returns the frontmatter header and the body separately.
 * Files without a `---` block are treated as body-only.
 */
function splitFile(raw: string): { header: string; body: string } {
  const match = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/);
  if (match) return { header: match[1], body: match[2] };
  return { header: "", body: raw };
}

/**
 * Splice a new body back into a raw file, preserving the frontmatter header.
 */
function spliceBody(raw: string, newBody: string): string {
  const { header } = splitFile(raw);
  return header + newBody;
}

/**
 * Parse frontmatter YAML from a raw file string.
 * Returns an empty object on failure.
 */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  try {
    return (parseYaml(match[1]) ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createCollabManager(options: CollabManagerOptions): CollabManager {
  const { storage, engine, history, contentDir } = options;

  // docId → CollabSessionState
  const sessions = new Map<string, CollabSessionState>();

  // ── Session eviction timer (every 5 minutes) ───────────────────────────────
  const _evictionTimer = setInterval(() => {
    const now = Date.now();
    for (const [docId, session] of sessions) {
      if (session.clients.size === 0 && now - session.lastActivity > 5 * 60_000) {
        sessions.delete(docId);
      }
    }
  }, 5 * 60_000);

  // ── Load / get session ─────────────────────────────────────────────────────

  async function getOrCreateSession(
    docId: string,
  ): Promise<CollabSessionState | null> {
    const existing = sessions.get(docId);
    if (existing) return existing;

    const filePath = join(contentDir, docId);
    let raw: string;
    try {
      raw = await storage.readText(filePath);
    } catch {
      return null; // Document not found
    }

    const { body } = splitFile(raw);
    const session = createCollabSession(docId, body);
    sessions.set(docId, session);
    return session;
  }

  // ── Auto-save ──────────────────────────────────────────────────────────────

  async function doAutoSave(session: CollabSessionState): Promise<void> {
    const filePath = join(contentDir, session.docId);
    let raw: string;
    try {
      raw = await storage.readText(filePath);
    } catch (err) {
      console.error(`[collab] auto-save: cannot read ${session.docId}:`, err);
      return;
    }

    const updated = spliceBody(raw, session.content);
    try {
      await storage.write(filePath, updated);
    } catch (err) {
      console.error(`[collab] auto-save: cannot write ${session.docId}:`, err);
      return;
    }

    if (history && session.lastEditor) {
      const fm = parseFrontmatter(raw);
      history.record({
        sourcePath: session.docId,
        content: session.content,
        frontmatter: fm,
        author: session.lastEditor,
        message: "collaborative edit",
      }).catch((err) => {
        console.error("[collab] history record failed:", err);
      });
    }

    // Rebuild the content index (async, non-blocking)
    engine.rebuild().catch((err) => {
      console.error("[collab] rebuild failed:", err);
    });

    broadcastToSession(session, {
      type: "saved",
      docId: session.docId,
      rev: session.rev,
    });
  }

  function scheduleAutoSave(session: CollabSessionState): void {
    if (session.saveTimer !== undefined) {
      clearTimeout(session.saveTimer);
    }
    session.saveTimer = setTimeout(() => {
      session.saveTimer = undefined;
      doAutoSave(session).catch((err) => {
        console.error("[collab] auto-save failed:", err);
      });
    }, SAVE_DELAY_MS);
  }

  function flushAutoSave(session: CollabSessionState): void {
    if (session.saveTimer !== undefined) {
      clearTimeout(session.saveTimer);
      session.saveTimer = undefined;
    }
    doAutoSave(session).catch((err) => {
      console.error("[collab] flush save failed:", err);
    });
  }

  // ── Message handlers ───────────────────────────────────────────────────────

  async function handleJoin(
    socket: WebSocket,
    clientId: string,
    user: AdminUser,
    docId: string,
  ): Promise<void> {
    const session = await getOrCreateSession(docId);
    if (!session) {
      try {
        socket.send(
          JSON.stringify({
            type: "error",
            code: "NOT_FOUND",
            message: `Document not found: ${docId}`,
          }),
        );
        socket.close(1008, "Document not found");
      } catch { /* already closed */ }
      return;
    }

    const slot = assignColorSlot(session);
    const color = PRESENCE_COLORS[slot % PRESENCE_COLORS.length];

    const client: ClientState = {
      clientId,
      userId: user.id,
      username: user.username,
      name: user.name,
      color,
      socket,
    };
    addClient(session, client);

    // Send joined message with full document state
    sendToClient(client, {
      type: "joined",
      docId,
      rev: session.rev,
      content: session.content,
      users: getPresence(session),
    });

    // Broadcast presence update to other clients
    broadcastToSession(
      session,
      { type: "presence", docId, users: getPresence(session) },
      clientId,
    );
  }

  function handleOp(
    session: CollabSessionState,
    clientId: string,
    clientRev: number,
    clientDelta: import("./types.ts").Delta,
  ): void {
    const client = session.clients.get(clientId);
    if (!client) return;

    const result = applyClientOp(session, clientId, clientRev, clientDelta);

    if (result === null) {
      // Client is too far behind — send a full resync
      sendToClient(client, {
        type: "joined",
        docId: session.docId,
        rev: session.rev,
        content: session.content,
        users: getPresence(session),
      });
      return;
    }

    const { serverDelta, newRev } = result;

    // Acknowledge to the submitting client
    sendToClient(client, { type: "ack", docId: session.docId, rev: newRev });

    // Broadcast to other clients
    broadcastToSession(
      session,
      {
        type: "op",
        docId: session.docId,
        rev: newRev,
        delta: serverDelta,
        authorId: client.userId,
        authorName: client.name,
      },
      clientId,
    );

    scheduleAutoSave(session);
  }

  function handleCursor(
    session: CollabSessionState,
    clientId: string,
    index: number,
    length: number,
  ): void {
    const client = session.clients.get(clientId);
    if (!client) return;
    client.cursor = { index, length };
    broadcastToSession(
      session,
      { type: "presence", docId: session.docId, users: getPresence(session) },
      clientId,
    );
  }

  function handleLeave(
    session: CollabSessionState,
    clientId: string,
  ): void {
    removeClient(session, clientId);

    if (session.clients.size === 0) {
      // Last client left — flush any pending save immediately
      flushAutoSave(session);
    } else {
      broadcastToSession(session, {
        type: "presence",
        docId: session.docId,
        users: getPresence(session),
      });
    }
  }

  // ── WebSocket lifecycle ────────────────────────────────────────────────────

  /**
   * Process a single parsed message from a client.
   * `session` may be null when we haven't joined yet.
   */
  async function dispatchMessage(
    socket: WebSocket,
    clientId: string,
    user: AdminUser,
    msg: ClientMsg,
    sessionRef: { current: CollabSessionState | null },
  ): Promise<void> {
    if (msg.type === "join") {
      await handleJoin(socket, clientId, user, msg.docId);
      sessionRef.current = sessions.get(msg.docId) ?? null;
      return;
    }

    const session = sessionRef.current;
    if (!session) {
      // Client hasn't joined a doc yet
      try {
        socket.send(
          JSON.stringify({ type: "error", code: "NOT_JOINED", message: "Send 'join' first" }),
        );
      } catch { /* ignore */ }
      return;
    }

    switch (msg.type) {
      case "op":
        handleOp(session, clientId, msg.rev, msg.delta);
        break;
      case "cursor":
        handleCursor(session, clientId, msg.index, msg.length);
        break;
      case "leave":
        handleLeave(session, clientId);
        sessionRef.current = null;
        break;
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    handleUpgrade(req: Request, user: AdminUser): Response {
      const url = new URL(req.url);
      const docId = url.searchParams.get("docId");
      if (!docId) {
        return new Response("Missing 'docId' query parameter", { status: 400 });
      }

      // Upgrade must happen synchronously in the request handler
      let socket: WebSocket;
      let response: Response;
      try {
        const upgraded = Deno.upgradeWebSocket(req);
        socket = upgraded.socket;
        response = upgraded.response;
      } catch (err) {
        console.error("[collab] WebSocket upgrade failed:", err);
        return new Response("WebSocket upgrade failed", { status: 500 });
      }

      const clientId = crypto.randomUUID();
      // Mutable ref so async handlers can share the current session
      const sessionRef: { current: CollabSessionState | null } = { current: null };

      socket.onopen = () => {
        // Auto-join the document on connection
        dispatchMessage(socket, clientId, user, { type: "join", docId, rev: 0 }, sessionRef)
          .catch((err) => console.error("[collab] join error:", err));
      };

      socket.onmessage = (event: MessageEvent) => {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(event.data as string) as ClientMsg;
        } catch {
          try {
            socket.send(
              JSON.stringify({ type: "error", code: "BAD_MESSAGE", message: "Invalid JSON" }),
            );
          } catch { /* ignore */ }
          return;
        }

        dispatchMessage(socket, clientId, user, msg, sessionRef).catch((err) => {
          console.error("[collab] message error:", err);
        });
      };

      socket.onclose = () => {
        const session = sessionRef.current;
        if (session) handleLeave(session, clientId);
        sessionRef.current = null;
      };

      socket.onerror = () => {
        const session = sessionRef.current;
        if (session) handleLeave(session, clientId);
        sessionRef.current = null;
      };

      return response;
    },
  };
}
