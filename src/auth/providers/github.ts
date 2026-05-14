/**
 * GitHub OAuth 2.0 provider.
 * Authorization code flow using native fetch — no OAuth library.
 */

import type { OAuthProvider } from "./types.ts";

export interface GitHubProviderConfig {
  clientId: string;
  clientSecret: string;
}

export function createGitHubProvider(config: GitHubProviderConfig): OAuthProvider {
  const { clientId, clientSecret } = config;

  function authorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async function exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string }> {
    const res = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      throw new Error(`GitHub token exchange failed: ${res.status}`);
    }

    const body = await res.json() as Record<string, string>;
    if (body.error) {
      throw new Error(`GitHub token exchange error: ${body.error_description ?? body.error}`);
    }

    return { accessToken: body.access_token };
  }

  async function getUser(accessToken: string): Promise<{
    id: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }> {
    const [profileRes, emailsRes] = await Promise.all([
      fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.github+json",
        },
      }),
      fetch("https://api.github.com/user/emails", {
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Accept": "application/vnd.github+json",
        },
      }),
    ]);

    if (!profileRes.ok) {
      throw new Error(`GitHub user profile fetch failed: ${profileRes.status}`);
    }

    const profile = await profileRes.json() as {
      id: number;
      name?: string;
      avatar_url?: string;
      email?: string;
    };

    // Primary email from /user/emails (handles users with private email setting)
    let email = profile.email ?? "";
    if (emailsRes.ok) {
      const emails = await emailsRes.json() as Array<{
        email: string;
        primary: boolean;
        verified: boolean;
      }>;
      const primary = emails.find((e) => e.primary && e.verified);
      if (primary) email = primary.email;
    }

    if (!email) {
      throw new Error("GitHub account has no verified primary email");
    }

    return {
      id: String(profile.id),
      email,
      name: profile.name,
      avatarUrl: profile.avatar_url,
    };
  }

  return { name: "github", authorizationUrl, exchangeCode, getUser };
}
