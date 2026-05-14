/**
 * Google OAuth 2.0 provider.
 * Authorization code flow using native fetch — no OAuth library.
 */

import type { OAuthProvider } from "./types.ts";

export interface GoogleProviderConfig {
  clientId: string;
  clientSecret: string;
}

export function createGoogleProvider(config: GoogleProviderConfig): OAuthProvider {
  const { clientId, clientSecret } = config;

  function authorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      access_type: "online",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async function exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string }> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google token exchange failed: ${res.status} ${body}`);
    }

    const body = await res.json() as { access_token: string; error?: string };
    if (body.error) {
      throw new Error(`Google token exchange error: ${body.error}`);
    }

    return { accessToken: body.access_token };
  }

  async function getUser(accessToken: string): Promise<{
    id: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }> {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Google userinfo fetch failed: ${res.status}`);
    }

    const profile = await res.json() as {
      id: string;
      email: string;
      name?: string;
      picture?: string;
    };

    return {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      avatarUrl: profile.picture,
    };
  }

  return { name: "google", authorizationUrl, exchangeCode, getUser };
}
