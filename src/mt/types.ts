/**
 * Machine translation type definitions.
 */

/** A machine translation provider */
export interface MachineTranslator {
  /** Translate a plain-text or Markdown string */
  translate(text: string, sourceLang: string, targetLang: string): Promise<string>;
  /** Translate multiple texts in a single API call (batched) */
  translateBatch(texts: string[], sourceLang: string, targetLang: string): Promise<string[]>;
  /** Provider identifier */
  readonly provider: "deepl" | "google" | "libretranslate";
}

/** Machine translation configuration */
export interface MachineTranslationConfig {
  /** Translation provider */
  provider: "deepl" | "google" | "libretranslate";
  /**
   * API key for the provider.
   * Supports "$ENV_VAR" expansion.
   */
  apiKey?: string;
  /**
   * For LibreTranslate: base URL of the self-hosted instance.
   * Default: "https://libretranslate.com"
   */
  baseUrl?: string;
  /** Whether machine translation is enabled (default: true when this block is present) */
  enabled?: boolean;
}
