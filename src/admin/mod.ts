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

export { hashPassword, verifyPassword, DUMMY_HASH } from "./auth/passwords.ts";

export type {
  AuthProvider,
  AuthProviderUser,
  AuthCredentials,
  AuthProviderConfig,
  LdapProviderConfig,
  SamlProviderConfig,
} from "./auth/provider.ts";
export { LocalAuthProvider } from "./auth/local-provider.ts";
export { LdapAuthProvider } from "./auth/ldap-provider.ts";
export { SamlAuthProvider } from "./auth/saml-provider.ts";
export { findOrProvisionUser } from "./auth/provisioner.ts";

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

// Submissions
export { createSubmissionManager } from "./submissions.ts";
export type {
  Submission,
  SubmissionStatus,
  SubmissionMeta,
  SubmissionManager,
  SubmissionManagerConfig,
} from "./submissions.ts";

// Editor
export { markdownToBlocks, blocksToMarkdown } from "./editor/serializer.ts";
export { parseMarkdownToBlocks } from "./editor/parser.ts";
export { generateBlockId } from "./editor/types.ts";
export type {
  Block,
  BlockDocument,
  BlockType,
  ParagraphBlock,
  HeadingBlock,
  ListBlock,
  BlockquoteBlock,
  CodeBlock,
  ImageBlock,
  DividerBlock,
  TableBlock,
  HtmlBlock,
} from "./editor/types.ts";
