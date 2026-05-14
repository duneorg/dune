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
  github?: { clientId: string; clientSecret: string };
  google?: { clientId: string; clientSecret: string };
  discord?: { clientId: string; clientSecret: string };
}

/**
 * Instantiate all configured OAuth providers.
 * Returns a map of provider name → OAuthProvider instance.
 */
export function createProviders(config: OAuthProvidersConfig): Map<string, OAuthProvider> {
  const providers = new Map<string, OAuthProvider>();

  if (config.github?.clientId) {
    providers.set("github", createGitHubProvider(config.github));
  }
  if (config.google?.clientId) {
    providers.set("google", createGoogleProvider(config.google));
  }
  if (config.discord?.clientId) {
    providers.set("discord", createDiscordProvider(config.discord));
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
