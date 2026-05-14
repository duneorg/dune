/**
 * Discord OAuth 2.0 provider.
 * Authorization code flow using native fetch — no OAuth library.
 */

import type { OAuthProvider } from "./types.ts";

export interface DiscordProviderConfig {
  clientId: string;
  clientSecret: string;
}

export function createDiscordProvider(config: DiscordProviderConfig): OAuthProvider {
  const { clientId, clientSecret } = config;

  function authorizationUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "identify email",
      state,
    });
    return `https://discord.com/api/oauth2/authorize?${params}`;
  }

  async function exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string }> {
    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Discord token exchange failed: ${res.status} ${body}`);
    }

    const body = await res.json() as { access_token: string; error?: string };
    if (body.error) {
      throw new Error(`Discord token exchange error: ${body.error}`);
    }

    return { accessToken: body.access_token };
  }

  async function getUser(accessToken: string): Promise<{
    id: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }> {
    const res = await fetch("https://discord.com/api/users/@me", {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`Discord user fetch failed: ${res.status}`);
    }

    const profile = await res.json() as {
      id: string;
      username: string;
      email: string;
      avatar?: string;
      global_name?: string;
    };

    if (!profile.email) {
      throw new Error("Discord account has no email (email scope not granted)");
    }

    // Discord CDN avatar URL
    const avatarUrl = profile.avatar
      ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
      : undefined;

    return {
      id: profile.id,
      email: profile.email,
      name: profile.global_name ?? profile.username,
      avatarUrl,
    };
  }

  return { name: "discord", authorizationUrl, exchangeCode, getUser };
}
