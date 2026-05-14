/**
 * Public auth types — site visitor accounts, distinct from admin users.
 */

/** A site visitor account. No passwords — OAuth and magic link only. */
export interface SiteUser {
  id: string;           // UUID
  email: string;
  name?: string;
  avatarUrl?: string;
  provider: string;     // "github" | "google" | "discord" | "magic" | "local"
  providerId?: string;  // provider's user ID (for OAuth)
  roles: string[];      // custom roles, e.g. ["member", "subscriber"]
  createdAt: number;    // ms timestamp
  lastSeenAt: number;
  enabled: boolean;
}

export type SiteUserCreate = Omit<SiteUser, "id" | "createdAt" | "lastSeenAt" | "enabled"> & {
  enabled?: boolean;
};

/** Public user session stored in the site session directory. */
export interface SiteSession {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  ip?: string;
}
