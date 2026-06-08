/**
 * Y.js WebSocket sync server for inline editing.
 *
 * Each connected client gets the full document state on connect (Y.js sync
 * step 1 + step 2) and receives broadcasts of other clients' updates.
 * Awareness (cursor presence) is handled via the Y.js awareness protocol.
 *
 * Message format matches the y-websocket wire protocol so the standard
 * `y-websocket` client provider works without modification:
 *   - Byte 0: message type (0 = SYNC, 1 = AWARENESS)
 *   - Remaining bytes: encoded per y-protocols/sync or y-protocols/awareness
 *
 * Security limits mirror those in the existing OT collab manager.
 */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";

import type { InlineEditClient, InlineEditSession } from "./types.ts";
import { persistYDoc } from "./ydoc-manager.ts";
import type { StorageAdapter } from "../storage/types.ts";

// ── Protocol constants ────────────────────────────────────────────────────────

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

// ── Security limits ───────────────────────────────────────────────────────────

const MAX_FRAME_BYTES = 512 * 1024;  // 512 KB per frame
const MAX_CONNECTIONS_PER_DOC = 20;

// ── Presence colours ──────────────────────────────────────────────────────────

const PRESENCE_COLORS = [
  "#e74c3c", "#3498db", "#2ecc71", "#f39c12",
  "#9b59b6", "#1abc9c", "#e67e22", "#e91e63",
];

function assignColor(session: InlineEditSession): string {
  const used = new Set([...session.clients.values()].map((c) => c.color));
  return (
    PRESENCE_COLORS.find((c) => !used.has(c)) ??
    PRESENCE_COLORS[Math.floor(Math.random() * PRESENCE_COLORS.length)]
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(socket: WebSocket, data: Uint8Array): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(data);
  }
}

function broadcast(
  session: InlineEditSession,
  data: Uint8Array,
  exclude?: string,
): void {
  for (const [clientId, client] of session.clients) {
    if (clientId !== exclude) send(client.socket, data);
  }
}

/**
 * Encode a sync step 1 message (server → client on connect).
 * Contains the server's state vector so the client can send missing updates.
 */
function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/**
 * Encode a sync step 2 message (server → client).
 * Contains all updates the client hasn't seen yet.
 */
function encodeSyncStep2(doc: Y.Doc, stateVector: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(encoder, doc, stateVector);
  return encoding.toUint8Array(encoder);
}

/**
 * Encode an awareness update for broadcast.
 */
function encodeAwarenessUpdate(
  awareness: awarenessProtocol.Awareness,
  changedClients: number[],
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
  );
  return encoding.toUint8Array(encoder);
}

// ── Connection handler ────────────────────────────────────────────────────────

/**
 * Wire up a new WebSocket connection to a Y.js editing session.
 *
 * @param socket - The already-upgraded WebSocket.
 * @param doc    - The in-memory Y.Doc for this document.
 * @param awareness - The shared Awareness instance for this document.
 * @param session - The in-memory session state.
 * @param client  - The authenticated client record (pre-populated by caller).
 * @param dataDir - Base data directory for ydoc persistence.
 * @param storage - Storage adapter.
 * @param autoFlushMs - Idle auto-flush interval (ms).
 * @param onFlush - Callback invoked when the auto-flush timer fires.
 */
export function connectClient(opts: {
  socket: WebSocket;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  session: InlineEditSession;
  client: InlineEditClient;
  dataDir: string;
  storage: StorageAdapter;
  autoFlushMs: number;
  onFlush: (sourcePath: string) => Promise<void>;
}): void {
  const { socket, doc, awareness, session, client, dataDir, storage, autoFlushMs, onFlush } = opts;

  if (session.clients.size >= MAX_CONNECTIONS_PER_DOC) {
    socket.close(1008, "Too many editors on this document");
    return;
  }

  session.clients.set(client.clientId, client);

  // ── Sync handshake ──────────────────────────────────────────────────────────

  // Send step 1: our state vector, so client can calculate missing updates.
  send(socket, encodeSyncStep1(doc));

  // Also send full sync step 2 immediately (client may be fresh).
  send(socket, encodeSyncStep2(doc, new Uint8Array()));

  // Send current awareness state to the new client.
  const awarenessClients = Array.from(awareness.getStates().keys());
  if (awarenessClients.length > 0) {
    send(socket, encodeAwarenessUpdate(awareness, awarenessClients));
  }

  // ── Message handler ─────────────────────────────────────────────────────────

  socket.onmessage = (event) => {
    if (socket.readyState !== WebSocket.OPEN) return;

    let data: Uint8Array;
    if (event.data instanceof ArrayBuffer) {
      data = new Uint8Array(event.data);
    } else if (event.data instanceof Uint8Array) {
      data = event.data;
    } else {
      // Text frames are not part of the y-websocket protocol.
      return;
    }

    if (data.byteLength > MAX_FRAME_BYTES) {
      socket.close(1009, "Message too large");
      return;
    }

    session.lastActivity = Date.now();

    try {
      const decoder = decoding.createDecoder(data);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === MESSAGE_SYNC) {
        // Handle sync message; encoder accumulates any reply.
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
        const syncMsgType = syncProtocol.readSyncMessage(
          decoder,
          replyEncoder,
          doc,
          null,
        );

        if (encoding.length(replyEncoder) > 1) {
          send(socket, encoding.toUint8Array(replyEncoder));
        }

        // If this was an update (step 2 or update broadcast), relay to peers.
        if (
          syncMsgType === syncProtocol.messageYjsSyncStep2 ||
          syncMsgType === syncProtocol.messageYjsUpdate
        ) {
          // Re-encode the raw update for peer broadcast.
          // We pull the update out of the decoder at the point we received the
          // update message type byte; simpler to re-encode from doc state.
          const updateEncoder = encoding.createEncoder();
          encoding.writeVarUint(updateEncoder, MESSAGE_SYNC);
          // Write update type byte + current doc state as update (lazy: full
          // state update; fine for small docs, negligible overhead).
          // For large docs a proper delta broadcast is better, but this is
          // correct and avoids re-parsing the update bytes.
          syncProtocol.writeSyncStep2(updateEncoder, doc, new Uint8Array());
          broadcast(session, encoding.toUint8Array(updateEncoder), client.clientId);

          // Schedule auto-flush.
          scheduleFlush(session, autoFlushMs, onFlush);

          // Persist asynchronously (fire-and-forget on each update; compacts).
          persistYDoc(dataDir, session.sourcePath, doc, storage).catch(() => {});
        }
      } else if (messageType === MESSAGE_AWARENESS) {
        // Update awareness; broadcast to all clients including sender (standard
        // y-websocket behaviour — clients deduplicate their own state).
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, client.clientId);
        const changedClients = Array.from(awareness.getStates().keys());
        broadcast(session, encodeAwarenessUpdate(awareness, changedClients));
      }
    } catch {
      // Malformed frame — silently drop.
    }
  };

  // ── Disconnect ──────────────────────────────────────────────────────────────

  socket.onclose = () => {
    session.clients.delete(client.clientId);

    // Remove awareness state for this client.
    awarenessProtocol.removeAwarenessStates(
      awareness,
      [client.clientId as unknown as number],
      "disconnect",
    );

    const remaining = Array.from(awareness.getStates().keys());
    if (remaining.length > 0) {
      broadcast(session, encodeAwarenessUpdate(awareness, remaining));
    }

    // Auto-flush when last client leaves if there's pending content.
    if (session.clients.size === 0) {
      clearFlushTimer(session);
      onFlush(session.sourcePath).catch(() => {});
    }
  };

  socket.onerror = () => {
    socket.close();
  };
}

// ── Auto-flush timer ──────────────────────────────────────────────────────────

function scheduleFlush(
  session: InlineEditSession,
  autoFlushMs: number,
  onFlush: (sourcePath: string) => Promise<void>,
): void {
  clearFlushTimer(session);
  session.flushTimer = setTimeout(() => {
    session.flushTimer = undefined;
    onFlush(session.sourcePath).catch(() => {});
  }, autoFlushMs);
}

function clearFlushTimer(session: InlineEditSession): void {
  if (session.flushTimer !== undefined) {
    clearTimeout(session.flushTimer);
    session.flushTimer = undefined;
  }
}
