/**
 * Admin system types — users, sessions, permissions, and config.
 */

import type { FreshContext } from "fresh";

/** Admin user stored in data/users/ */
export interface AdminUser {
  id: string;
  username: string;
  email: string;
  /** PBKDF2 hash of password */
  passwordHash: string;
  role: AdminRole;
  /** Display name */
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Whether this account is active */
  enabled: boolean;
}

/** Admin user roles with hierarchical permissions */
export type AdminRole = "admin" | "editor" | "author";

/** Session stored in .dune/admin/sessions/ (ephemeral, gitignored) */
export interface AdminSession {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  /** IP address of the client that created the session */
  ip?: string;
}

/** Permission definitions per role */
export const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  admin: [
    "pages.create", "pages.read", "pages.update", "pages.delete",
    "media.upload", "media.read", "media.delete",
    "users.create", "users.read", "users.update", "users.delete",
    "config.read", "config.update",
    "submissions.read", "submissions.delete",
    "admin.access",
  ],
  editor: [
    "pages.create", "pages.read", "pages.update",
    "media.upload", "media.read", "media.delete",
    "config.read",
    "submissions.read",
    "admin.access",
  ],
  author: [
    "pages.create", "pages.read", "pages.update",
    "media.upload", "media.read",
    "submissions.read",
    "admin.access",
  ],
};

/** All possible admin permissions */
export type AdminPermission =
  | "pages.create" | "pages.read" | "pages.update" | "pages.delete"
  | "media.upload" | "media.read" | "media.delete"
  | "users.create" | "users.read" | "users.update" | "users.delete"
  | "config.read" | "config.update"
  | "submissions.read" | "submissions.delete"
  | "admin.access";

/** Admin configuration (added to DuneConfig) */
export interface AdminConfig {
  /** Admin panel route prefix (default: "/admin") */
  path: string;
  /** Session lifetime in seconds (default: 86400 = 24h) */
  sessionLifetime: number;
  /**
   * Persistent data directory — git-tracked, user-authored records.
   * Stores: admin users, form submissions.
   * (default: "data")
   */
  dataDir: string;
  /**
   * Runtime directory — ephemeral, machine-local, gitignored.
   * Stores: sessions, scheduled actions, revision history, workflow state.
   * (default: ".dune/admin")
   */
  runtimeDir: string;
  /** Whether admin panel is enabled (default: true) */
  enabled: boolean;
}

/** Result of an auth check */
export interface AuthResult {
  authenticated: boolean;
  user?: AdminUser;
  session?: AdminSession;
  error?: string;
}

/** Safe user info (no password hash) for API responses */
export interface AdminUserInfo {
  id: string;
  username: string;
  email: string;
  role: AdminRole;
  name: string;
  createdAt: number;
  enabled: boolean;
}

/**
 * Plugin-provided replacement for the built-in block editor.
 *
 * Register via {@link AdminServices.contentEditor} in a plugin's `adminServices()`.
 * The edit route delegates to `pageEditorHandler` instead of the default block editor.
 *
 * @since 0.24.0
 */
export interface ContentEditorPlugin {
  /**
   * Handle `GET /admin/pages/edit?path=...`.
   *
   * Receives the full Fresh context — call `ctx.render(component)` to render
   * within the admin layout, or return any `Response` directly. Access
   * `ctx.state.adminContext` for engine, config, and other admin services.
   */
  pageEditorHandler(
    ctx: FreshContext<AdminState>,
  ): Response | Promise<Response>;

  /**
   * Optional WebSocket upgrade handler for real-time collaboration.
   *
   * When present, `GET /admin/api/content-editor/ws?path=...` delegates here
   * after auth and path validation. Return a `101 Switching Protocols` response
   * via `Deno.upgradeWebSocket`. When absent the WS endpoint responds 501.
   */
  wsHandler?: (
    req: Request,
    user: { id: string; name: string },
  ) => Response;
}

/** Fresh 2 context state for admin routes — set by middleware in fresh-app.ts */
export interface AdminState {
  auth: AuthResult;
  /**
   * Per-site admin context, injected by the per-site middleware in fresh-app.ts.
   * Avoids the module-level singleton bug in multisite: each site's Fresh app
   * has its own middleware that closes over its own AdminContext.
   */
  adminContext: import("./context.ts").AdminContext;
}

/** Convert AdminUser to safe API response */
export function toUserInfo(user: AdminUser): AdminUserInfo {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    name: user.name,
    createdAt: user.createdAt,
    enabled: user.enabled,
  };
}
