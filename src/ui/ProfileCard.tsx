/** @jsxImportSource preact */
/**
 * ProfileCard — server-rendered component.
 *
 * Displays user info from a SiteUser object. Shows avatar (if avatarUrl),
 * display name, email, roles, and a logout button that POSTs to /auth/logout.
 */

import { h } from "preact";
import type { JSX } from "preact";

/** User data displayed by the {@link ProfileCard} component. */
export interface ProfileCardUser {
  name?: string;
  email: string;
  avatarUrl?: string;
  roles: string[];
}

/** Props for the {@link ProfileCard} server-rendered component. */
export interface ProfileCardProps {
  user: ProfileCardUser;
  className?: string;
}

export default function ProfileCard({ user, className }: ProfileCardProps): JSX.Element {
  const displayName = user.name ?? user.email;

  return (
    <div class={`dune-profile-card${className ? ` ${className}` : ""}`}>
      <div class="dune-profile-card__header">
        {user.avatarUrl ? (
          <img
            class="dune-profile-card__avatar"
            src={user.avatarUrl}
            alt={displayName}
            width={48}
            height={48}
          />
        ) : (
          <div
            class="dune-profile-card__avatar-placeholder"
            aria-hidden="true"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <div class="dune-profile-card__identity">
          <div class="dune-profile-card__name">{displayName}</div>
          <div class="dune-profile-card__email">{user.email}</div>
        </div>
      </div>

      {user.roles.length > 0 && (
        <div class="dune-profile-card__roles" aria-label="Roles">
          {user.roles.map((role) => (
            <span key={role} class={`dune-profile-card__role dune-profile-card__role--${role}`}>
              {role}
            </span>
          ))}
        </div>
      )}

      <form
        class="dune-profile-card__logout"
        method="POST"
        action="/auth/logout"
      >
        <button type="submit" class="dune-profile-card__logout-btn">
          Sign out
        </button>
      </form>
    </div>
  );
}
