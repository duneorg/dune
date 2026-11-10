/**
 * Inline editing service port.
 *
 * Core owns who may edit: after the site's authentication has run it resolves
 * the editor (a site user, or whoever the `editor.session` provider signs in),
 * checks `pages.update` and, for requests that change something, the request's
 * origin. It then hands the request to the plugin that provides the
 * `editor.inline` capability (e.g. `jsr:@dune/plugin-inline-edit`) at
 * `/api/inline-edit/ws` (a WebSocket upgrade) and `/api/inline-edit/*` (plain
 * requests). Both respond 501 when no plugin has filled the slot.
 *
 * The wire protocol spoken over the WebSocket, the HTTP routes below
 * `/api/inline-edit/` and any client-side editor UI are entirely the providing
 * plugin's concern; core treats them as opaque.
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

// ── Editor ────────────────────────────────────────────────────────────────────

/**
 * Who is editing: an authenticated user that core has already checked for
 * `pages.update`. `source` says where the identity came from.
 */
export interface EditorIdentity {
  id: string;
  /** Display name: the username, else the name, else the email. */
  username: string;
  /** Every role on the user record (admin-tier roles and content-gating tags mixed). */
  roles: string[];
  /**
   * The admin-tier relation this editor holds on the site: `admin` and `editor` may edit any
   * page, `author` only the pages it created. Decided by core from the site's
   * `system.role_grants` (a group `staff` mapped to `editor` makes its members `editor`), so a
   * provider applies ownership rules to this and not to role names.
   */
  relation: "admin" | "editor" | "author";
  /** `site`: signed in through the site's own login; `session`: through the `editor.session` provider. */
  source: "site" | "session";
}

/** What core hands {@link InlineEditManager.handleRequest} besides the request. */
export interface InlineEditRequestContext {
  /** The editor, already authenticated and checked for `pages.update`. */
  editor: EditorIdentity;
  /**
   * The path below `/api/inline-edit/`, without a leading slash and still
   * percent-encoded (`content/pages%2Fabout%2Fdefault.md/commit`).
   */
  path: string;
  /**
   * Frontmatter of an indexed page, or null when `sourcePath` is not a page of
   * this site. Lets a handler apply its own ownership rules.
   */
  pageFrontmatter(sourcePath: string): Promise<Record<string, unknown> | null>;
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
   * Handle a plain HTTP request below `/api/inline-edit/` (everything except
   * the WebSocket upgrade). Core has authenticated the editor, checked
   * `pages.update` and, for POST, PUT, PATCH and DELETE, that the request is
   * same-origin; the handler enforces anything page-specific (which page types
   * and owners this editor may write) and fires the `onPage*` events for what
   * it writes. Return 404 for a path it does not serve.
   */
  handleRequest(req: Request, ctx: InlineEditRequestContext): Promise<Response>;

  /**
   * Return live presence data — which documents have active editing
   * sessions, and who is editing them.
   * Only documents with at least one connected client are included.
   */
  getPresence(): DocumentPresence[];
}
