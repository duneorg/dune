/**
 * DeepL machine translation provider.
 * Supports both Free (keys ending in ":fx") and Pro API tiers.
 */

import type { MachineTranslator } from "./types.ts";

/** DeepL target language special cases — map generic codes to preferred variants. */
const TARGET_LANG_MAP: Record<string, string> = {
  en: "EN-US",
  pt: "PT-BR",
};

function normalizeSourceLang(lang: string): string {
  return lang.toUpperCase();
}

function normalizeTargetLang(lang: string): string {
  const upper = lang.toUpperCase();
  return TARGET_LANG_MAP[lang.toLowerCase()] ?? upper;
}

export class DeepLTranslator implements MachineTranslator {
  readonly provider = "deepl" as const;

  private readonly endpoint: string;

  constructor(private apiKey: string) {
    // Free keys end with ":fx"; they use the api-free subdomain
    this.endpoint = apiKey.endsWith(":fx")
      ? "https://api-free.deepl.com/v2/translate"
      : "https://api.deepl.com/v2/translate";
  }

  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const results = await this.translateBatch([text], sourceLang, targetLang);
    return results[0];
  }

  async translateBatch(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Authorization": `DeepL-Auth-Key ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: texts,
          source_lang: normalizeSourceLang(sourceLang),
          target_lang: normalizeTargetLang(targetLang),
          tag_handling: "markdown",
        }),
      });
    } catch (err) {
      throw new Error(`DeepL network error: ${err}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`DeepL API error ${res.status}: ${body}`);
    }

    const data = await res.json() as { translations: Array<{ text: string }> };
    return data.translations.map((t) => t.text);
  }
}
