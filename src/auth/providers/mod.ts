/**
 * OAuth provider registry — factory that returns the correct provider
 * based on name and config from site.yaml.
 */

export type { OAuthProvider } from "./types.ts";
export { createGitHubProvider } from "./github.ts";
export { createGoogleProvider } from "./google.ts";
export { createDiscordProvider } from "./discord.ts";

import { createGitHubProvider } from "./github.ts";
import { createGoogleProvider } from "./google.ts";
import { createDiscordProvider } from "./discord.ts";
import type { OAuthProvider } from "./types.ts";

export interface OAuthProvidersConfig {
  github?: { client_id: string; client_secret: string };
  google?: { client_id: string; client_secret: string };
  discord?: { client_id: string; client_secret: string };
}

/**
 * Instantiate all configured OAuth providers.
 * Returns a map of provider name → OAuthProvider instance.
 */
export function createProviders(config: OAuthProvidersConfig): Map<string, OAuthProvider> {
  const providers = new Map<string, OAuthProvider>();

  // Config keys are snake_case; the provider factories keep their own option names.
  const creds = (c: { client_id: string; client_secret: string }) => ({
    clientId: c.client_id,
    clientSecret: c.client_secret,
  });
  if (config.github?.client_id) {
    providers.set("github", createGitHubProvider(creds(config.github)));
  }
  if (config.google?.client_id) {
    providers.set("google", createGoogleProvider(creds(config.google)));
  }
  if (config.discord?.client_id) {
    providers.set("discord", createDiscordProvider(creds(config.discord)));
  }

  return providers;
}

/**
 * Get a single configured provider by name.
 * Returns null if the provider is not configured.
 */
export function getProvider(
  name: string,
  config: OAuthProvidersConfig,
): OAuthProvider | null {
  const providers = createProviders(config);
  return providers.get(name) ?? null;
}
