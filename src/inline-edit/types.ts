/**
 * Inline editing service port.
 *
 * Core defines this interface and consumes it from the admin panel routes
 * (`/api/inline-edit/ws`, the presence endpoint, and the content commit /
 * field-patch endpoints). It does not ship an implementation: a plugin
 * provides one via `DunePlugin.adminServices` (e.g.
 * `jsr:@dune/plugin-inline-edit`), and the endpoints respond 501 when
 * no plugin has filled the slot.
 *
 * The wire protocol spoken over the WebSocket — and any client-side editor
 * UI — is entirely the providing plugin's concern; core treats both as
 * opaque.
 */

// ── Presence ──────────────────────────────────────────────────────────────────

/** Active editor info returned by {@link InlineEditManager.getPresence}. */
export interface ActiveEditor {
  userId: string;
  name: string;
  /** Display color (hex) assigned by the editing service. */
  color: string;
}

/** Presence record for one document that has at least one active editor. */
export interface DocumentPresence {
  sourcePath: string;
  editors: ActiveEditor[];
}

// ── Manager ───────────────────────────────────────────────────────────────────

/** Public interface for an inline editing server manager. */
export interface InlineEditManager {
  /**
   * Handle an HTTP → WebSocket upgrade for a live editing session.
   * Caller must have already authenticated the user.
   * Returns a 101 response on success, or 4xx on bad request.
   */
  handleUpgrade(req: Request, user: { id: string; name: string }): Response;

  /**
   * Flush the live editing state for `sourcePath` to a history revision
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

  /**
   * Return live presence data — which documents have active editing
   * sessions, and who is editing them.
   * Only documents with at least one connected client are included.
   */
  getPresence(): DocumentPresence[];
}
