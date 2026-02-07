/**
 * Admin system types — users, sessions, permissions, and config.
 */

/** Admin user stored in .dune/admin/users/ */
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

/** Session stored in .dune/admin/sessions/ */
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
    "admin.access",
  ],
  editor: [
    "pages.create", "pages.read", "pages.update",
    "media.upload", "media.read", "media.delete",
    "config.read",
    "admin.access",
  ],
  author: [
    "pages.create", "pages.read", "pages.update",
    "media.upload", "media.read",
    "admin.access",
  ],
};

/** All possible admin permissions */
export type AdminPermission =
  | "pages.create" | "pages.read" | "pages.update" | "pages.delete"
  | "media.upload" | "media.read" | "media.delete"
  | "users.create" | "users.read" | "users.update" | "users.delete"
  | "config.read" | "config.update"
  | "admin.access";

/** Admin configuration (added to DuneConfig) */
export interface AdminConfig {
  /** Admin panel route prefix (default: "/admin") */
  path: string;
  /** Session lifetime in seconds (default: 86400 = 24h) */
  sessionLifetime: number;
  /** Admin data directory (default: ".dune/admin") */
  dataDir: string;
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
