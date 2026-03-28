/**
 * LibreTranslate provider — supports self-hosted instances.
 * LibreTranslate does not support batch requests, so batch is implemented
 * as sequential individual requests.
 */

import type { MachineTranslator } from "./types.ts";

export class LibreTranslateTranslator implements MachineTranslator {
  readonly provider = "libretranslate" as const;

  constructor(
    private baseUrl: string,
    private apiKey?: string,
  ) {
    // Strip trailing slash for consistent URL construction
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async translate(text: string, sourceLang: string, targetLang: string): Promise<string> {
    const endpoint = `${this.baseUrl}/translate`;

    const body: Record<string, string> = {
      q: text,
      source: sourceLang,
      target: targetLang,
      format: "text",
    };
    if (this.apiKey) {
      body.api_key = this.apiKey;
    }

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`LibreTranslate network error: ${err}`);
    }

    if (!res.ok) {
      const respBody = await res.text().catch(() => "");
      throw new Error(`LibreTranslate API error ${res.status}: ${respBody}`);
    }

    const data = await res.json() as { translatedText: string };
    return data.translatedText;
  }

  async translateBatch(texts: string[], sourceLang: string, targetLang: string): Promise<string[]> {
    // LibreTranslate has no batch endpoint — execute sequentially
    const results: string[] = [];
    for (const text of texts) {
      results.push(await this.translate(text, sourceLang, targetLang));
    }
    return results;
  }
}
