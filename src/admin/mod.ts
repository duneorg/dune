/**
 * Admin panel — barrel exports.
 */

export { createAdminHandler } from "./server.ts";
export type { AdminServerConfig } from "./server.ts";

export { createSessionManager } from "./auth/sessions.ts";
export type { SessionManager, SessionManagerConfig } from "./auth/sessions.ts";

export { createUserManager } from "./auth/users.ts";
export type { UserManager, UserManagerConfig, CreateUserInput } from "./auth/users.ts";

export { createAuthMiddleware } from "./auth/middleware.ts";
export type { AuthMiddleware, AuthMiddlewareConfig } from "./auth/middleware.ts";

export { hashPassword, verifyPassword } from "./auth/passwords.ts";

export type {
  AdminUser,
  AdminRole,
  AdminSession,
  AdminPermission,
  AdminConfig,
  AuthResult,
  AdminUserInfo,
} from "./types.ts";
export { ROLE_PERMISSIONS, toUserInfo } from "./types.ts";
