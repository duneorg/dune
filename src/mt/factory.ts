/**
 * Factory for creating a MachineTranslator from config.
 */

import type { MachineTranslationConfig, MachineTranslator } from "./types.ts";
import { DeepLTranslator } from "./deepl.ts";
import { GoogleTranslator } from "./google.ts";
import { LibreTranslateTranslator } from "./libretranslate.ts";

/**
 * Create a MachineTranslator from config.
 * Returns null if MT is disabled or provider is unknown.
 * API keys starting with "$" are expanded from the environment.
 */
export function createMachineTranslator(config: MachineTranslationConfig): MachineTranslator | null {
  if (config.enabled === false) return null;

  const rawKey = config.apiKey ?? "";
  const key = rawKey.startsWith("$")
    ? (Deno.env.get(rawKey.slice(1)) ?? rawKey)
    : rawKey;

  switch (config.provider) {
    case "deepl":
      return new DeepLTranslator(key);
    case "google":
      return new GoogleTranslator(key);
    case "libretranslate":
      return new LibreTranslateTranslator(
        config.baseUrl ?? "https://libretranslate.com",
        key || undefined,
      );
    default:
      return null;
  }
}
