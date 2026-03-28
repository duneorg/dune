/**
 * Google Cloud Translation API v2 (Basic) provider.
 */

import type { MachineTranslator } from "./types.ts";

export class GoogleTranslator implements MachineTranslator {
  readonly provider = "google" as const;

  constructor(private apiKey: string) {}

  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const results = await this.translateBatch([text], sourceLang, targetLang);
    return results[0];
  }

  async translateBatch(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
    const endpoint = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(this.apiKey)}`;

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: texts,
          source: sourceLang,
          target: targetLang,
          format: "text",
        }),
      });
    } catch (err) {
      throw new Error(`Google Translate network error: ${err}`);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Google Translate API error ${res.status}: ${body}`);
    }

    const data = await res.json() as { data: { translations: Array<{ translatedText: string }> } };
    return data.data.translations.map((t) => t.translatedText);
  }
}
