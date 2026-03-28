---
title: "Machine Translation"
published: true
visible: true
taxonomy:
  audience: [webmaster, editor]
  difficulty: [beginner]
  topic: [content, i18n, translation]
metadata:
  description: "Automatically translate pages using DeepL, Google Translate, or LibreTranslate from the admin panel"
---

# Machine Translation

Dune can automatically translate pages using DeepL, Google Translate, or a self-hosted LibreTranslate instance. Once configured, a **🤖** button appears next to untranslated pages in the translation status dashboard.

Machine translation produces a draft — a translated copy of the page saved as a new language file — which editors can then review and refine.

---

## Quick start

### 1. Get an API key

| Provider | Sign up | Free tier |
|----------|---------|-----------|
| [DeepL](https://www.deepl.com/pro-api) | deepl.com | 500,000 chars/month |
| [Google Translate](https://cloud.google.com/translate) | console.cloud.google.com | $0 up to 500k chars/month |
| [LibreTranslate](https://libretranslate.com) | Self-hosted or libretranslate.com | Self-hosted = free |

### 2. Configure in `site.yaml`

```yaml
machine_translation:
  provider: "deepl"           # "deepl" | "google" | "libretranslate"
  apiKey: "$DEEPL_API_KEY"    # "$ENV_VAR" expansion supported
```

Store your key in an environment variable — never commit it to version control.

### 3. Restart the server

The 🤖 button will appear on the **Admin → Translations** dashboard for all missing language versions.

---

## Providers

### DeepL

Best quality for European languages. Supports Markdown-aware translation (formatting is preserved).

```yaml
machine_translation:
  provider: "deepl"
  apiKey: "$DEEPL_API_KEY"
```

Free API keys end with `:fx` — Dune auto-detects which endpoint to use.

### Google Translate

Widest language coverage. Uses the Cloud Translation API v2 (Basic).

```yaml
machine_translation:
  provider: "google"
  apiKey: "$GOOGLE_TRANSLATE_API_KEY"
```

### LibreTranslate

Self-hosted, open-source, no usage limits or vendor lock-in.

```yaml
machine_translation:
  provider: "libretranslate"
  baseUrl: "https://translate.example.com"    # your instance URL
  apiKey: "$LIBRETRANSLATE_API_KEY"            # optional (if your instance requires it)
```

---

## How it works

When you click **🤖** on a missing translation:

1. Dune reads the source page (default language)
2. The page body and title are sent to the configured MT provider
3. The translated content is written as a new language file:
   - `content/blog/post/default.md` → `content/blog/post/default.de.md`
4. The page is indexed and immediately accessible via its translated URL
5. The dashboard row updates from "Missing" to "Translated"

The API key never leaves the server — all MT requests are made server-side.

---

## REST API

### Check MT status

```
GET /admin/api/i18n/mt-status
```

Returns whether machine translation is configured:

```json
{
  "enabled": true,
  "provider": "deepl"
}
```

### Translate a page

```
POST /admin/api/i18n/translate-page
```

```json
{
  "sourcePath": "content/blog/my-post/default.md",
  "targetLang": "de"
}
```

Translates the page body and title, writes the translated file, triggers a content rebuild.

Response:
```json
{
  "ok": true,
  "targetPath": "content/blog/my-post/default.de.md"
}
```

### Translate a segment

```
POST /admin/api/i18n/translate-segment
```

```json
{
  "text": "Hello world",
  "from": "en",
  "to": "de"
}
```

Response:
```json
{
  "ok": true,
  "translation": "Hallo Welt"
}
```

---

## Configuration reference

```yaml
# site.yaml
machine_translation:
  provider: "deepl"          # string — "deepl" | "google" | "libretranslate"
  apiKey: "$DEEPL_API_KEY"   # string — API key ("$ENV_VAR" expansion supported)
  baseUrl: "https://..."     # string — LibreTranslate instance URL (libretranslate only)
  enabled: true              # boolean — Set to false to disable without removing config
```

---

## Notes

- Machine translation is **always a draft** — review and proofread before publishing
- The translation engine preserves Markdown formatting (headings, bold, links, code blocks)
- Frontmatter other than `title` is copied unchanged from the source page
- If a translated file already exists, clicking 🤖 overwrites it with a fresh translation
- MT calls time out after 30 seconds; a 🔴 indicator appears if the provider is unreachable
