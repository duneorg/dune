/**
 * CollabSession — in-memory state for one collaboratively-edited document.
 *
 * Each session holds:
 *   - the current document body text
 *   - a monotonically increasing revision counter
 *   - a ring buffer of recent operations (for OT of late-arriving clients)
 *   - a map of connected clients with their presence info
 */

import type {
  Delta,
  ClientState,
  CollabSessionState,
  PresenceInfo,
  ServerMsg,
} from "./types.ts";
import { transform, apply } from "./ot.ts";

/** Maximum number of historical ops kept for OT. Clients more than this many
 *  revisions behind receive a full resync instead of op-by-op catch-up. */
export const MAX_HISTORY = 100;

/** Debounce delay in milliseconds for the auto-save timer. */
export const SAVE_DELAY_MS = 3_000;

/** Eight editor presence colors (hex). */
export const PRESENCE_COLORS = [
  "#0d9488", // teal
  "#ea580c", // orange
  "#7c3aed", // violet
  "#e11d48", // rose
  "#d97706", // amber
  "#0284c7", // sky
  "#16a34a", // green
  "#db2777", // pink
];

// ── Factory ───────────────────────────────────────────────────────────────────

/** Create a fresh CollabSession for the given document body. */
export function createCollabSession(
  docId: string,
  initialContent: string,
): CollabSessionState {
  return {
    docId,
    rev: 0,
    content: initialContent,
    history: [],
    clients: new Map(),
    lastEditor: "",
    lastActivity: Date.now(),
    saveTimer: undefined,
    usedColorSlots: new Set(),
  };
}

// ── Client management ─────────────────────────────────────────────────────────

/** Assign the next free color slot to a new client. Returns the slot index. */
export function assignColorSlot(session: CollabSessionState): number {
  for (let i = 0; i < PRESENCE_COLORS.length; i++) {
    if (!session.usedColorSlots.has(i)) {
      session.usedColorSlots.add(i);
      return i;
    }
  }
  // All 8 slots full — wrap around (shouldn't happen in practice)
  return session.clients.size % PRESENCE_COLORS.length;
}

/** Add a client to the session. Returns the assigned color. */
export function addClient(session: CollabSessionState, client: ClientState): void {
  session.clients.set(client.clientId, client);
}

/** Remove a client from the session. Frees its color slot. */
export function removeClient(session: CollabSessionState, clientId: string): void {
  const client = session.clients.get(clientId);
  if (!client) return;
  // Free the color slot (find which slot this color was assigned to)
  const slotIndex = PRESENCE_COLORS.indexOf(client.color);
  if (slotIndex !== -1) session.usedColorSlots.delete(slotIndex);
  session.clients.delete(clientId);
}

// ── Operation application ─────────────────────────────────────────────────────

/**
 * Apply a client-submitted operation to the session.
 *
 * If the client's revision (`clientRev`) is behind the server's current
 * revision, the submitted delta is transformed against the intervening ops
 * before being applied.
 *
 * Returns the server delta (post-transform) and the new revision, or null if
 * the client is too far behind for OT (needs a full resync).
 */
export function applyClientOp(
  session: CollabSessionState,
  clientId: string,
  clientRev: number,
  clientDelta: Delta,
): { serverDelta: Delta; newRev: number } | null {
  const serverRev = session.rev;

  // Fast path: client is up to date
  if (clientRev === serverRev) {
    const newContent = apply(session.content, clientDelta);
    const newRev = serverRev + 1;
    session.content = newContent;
    session.rev = newRev;
    session.lastEditor = session.clients.get(clientId)?.username ?? "unknown";
    session.lastActivity = Date.now();
    pushHistory(session, newRev, clientDelta, clientId);
    return { serverDelta: clientDelta, newRev };
  }

  // Client is behind: need OT
  if (clientRev < serverRev - MAX_HISTORY) {
    // Too far behind; client must resync
    return null;
  }

  // Collect the ops applied since clientRev
  const concurrentOps = session.history.filter((h) => h.rev > clientRev);

  // Transform the client delta through each concurrent server op
  let transformed = clientDelta;
  for (const hist of concurrentOps) {
    transformed = transform(transformed, hist.delta, "left");
  }

  const newContent = apply(session.content, transformed);
  const newRev = serverRev + 1;
  session.content = newContent;
  session.rev = newRev;
  session.lastEditor = session.clients.get(clientId)?.username ?? "unknown";
  session.lastActivity = Date.now();
  pushHistory(session, newRev, transformed, clientId);

  return { serverDelta: transformed, newRev };
}

/** Append to the history ring buffer, evicting old entries when full. */
function pushHistory(
  session: CollabSessionState,
  rev: number,
  delta: Delta,
  authorId: string,
): void {
  session.history.push({ rev, delta, authorId });
  if (session.history.length > MAX_HISTORY) {
    session.history.shift();
  }
}

// ── Presence ──────────────────────────────────────────────────────────────────

/** Build a PresenceInfo array from the session's current client map. */
export function getPresence(session: CollabSessionState): PresenceInfo[] {
  return [...session.clients.values()].map((c) => ({
    clientId: c.clientId,
    userId: c.userId,
    username: c.username,
    name: c.name,
    color: c.color,
    cursor: c.cursor,
  }));
}

// ── Messaging ─────────────────────────────────────────────────────────────────

/** Send a message to a single client. Silently ignores closed sockets. */
export function sendToClient(client: ClientState, msg: ServerMsg): void {
  if (client.socket.readyState !== WebSocket.OPEN) return;
  try {
    client.socket.send(JSON.stringify(msg));
  } catch {
    // Socket may have closed between the readyState check and send()
  }
}

/**
 * Broadcast a message to all clients in the session,
 * optionally excluding one (e.g. the sender of an op).
 */
export function broadcastToSession(
  session: CollabSessionState,
  msg: ServerMsg,
  excludeClientId?: string,
): void {
  for (const client of session.clients.values()) {
    if (client.clientId === excludeClientId) continue;
    sendToClient(client, msg);
  }
}
