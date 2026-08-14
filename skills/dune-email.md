# Skill: Dune Email

Transactional email via `EmailClient.send()`. There is no ambient, pre-configured `email` singleton anywhere in Dune — every consumer constructs its own client from config, except background jobs, which get one for free on `ctx.email`.

---

## Call surface

**There is no `import { email } from "@dune/core"` (or `@dune/core/email`).** No such export exists — `@dune/core/email` only exports `createEmailClient`, `createEmailProvider`, provider classes, and types. You build the client yourself:

```ts
import { createEmailClient, createEmailProvider } from "@dune/core/email";

const provider = createEmailProvider({
  provider: "resend",
  from: "hello@example.com",
  resend: { apiKey: Deno.env.get("RESEND_API_KEY")! },
});

const email = createEmailClient({
  provider,
  from: "hello@example.com",
  // storage is required if you'll use `template:` — see "Email templates" below
});

await email.send({
  to: "user@example.com",
  subject: "Your magic link",
  template: "magic-link",
  data: { link, expiresIn: "15 minutes" },
});
```

`to` accepts a string or `string[]`. `send()` requires either `template` or (`html` + `subject`) — it throws otherwise. If `template` is given, `subject` becomes optional (the template can supply its own — see below) and `html` is ignored if also present. **Precedence when both are present**: an explicit `subject:` passed to `send()` always wins over the template's own subject (`sendOpts.subject ?? rendered.subject` in `client.ts`) — the template's subject is only a fallback for when you don't pass one, not an override.

**Plain-text auto-generation only happens on the `template:` path, not the raw-`html` path.** A template's renderer (`templates.ts`) strips tags from its own rendered HTML into `rendered.text`, and `client.ts` uses that as the fallback (`sendOpts.text ?? rendered.text`) — so a template-based send does get a text part for free. But `send({ html, subject })` without a `template` sets `text` from `sendOpts.text` only — if you don't pass `text` yourself, none of `client.ts` or any provider (`resend.ts`, `smtp.ts`, etc. — checked all of them) generates one; the message just goes out with no text part. If you're not using a template, pass `text:` explicitly when you care about it.

**The one place you get a pre-built client for free is background jobs**: `JobContext.email` (`src/jobs/types.ts`) is a real, already-configured `EmailClient`, constructed from `site.yaml`'s `email:` config with `storage` wired in — `template:` works there without extra setup. Hooks (`HookContext`) and TSX content pages (`ContentPageProps`) get neither `email` nor `content` nor `db` — see the `dune-plugin-authoring` skill's "Hook context" section for the full story on hooks.

---

## Provider config

```yaml
# site.yaml — top level, not nested under a "site:" key
email:
  from: "My Site <hello@example.com>"
  provider: resend               # console (default) | smtp | resend | postmark | sendgrid
  resend:
    apiKey: "${RESEND_API_KEY}"
```

```yaml
# SMTP (self-hosted)
email:
  from: "My Site <hello@example.com>"
  provider: smtp
  smtp:
    host: smtp.example.com
    port: 587
    secure: false                # true = implicit TLS on 465, false = STARTTLS on 587
    user: "${SMTP_USER}"
    pass: "${SMTP_PASS}"         # field is `pass`, not `password`
```

When `email:` is omitted, or the selected provider's required credentials are missing, `createEmailProvider()` (`src/email/providers/mod.ts`) silently falls back to `ConsoleEmailProvider` — it logs the message to stdout and does not send. This fallback is config-driven, not environment-driven — see the dev-mode section below for why that distinction matters.

---

## Email templates

Templates live in `emails/` at the project root. `loadTemplate()` (`src/email/templates.ts`) tries extensions in this exact order: **`.email.tsx`, then `.email.md`, then `.email.mdx`** — not tsx/mdx/md.

### TSX (`.email.tsx`)

```tsx
// emails/magic-link.email.tsx
export type Data = { link: string; expiresIn: string };

export default ({ link, expiresIn }: Data) => (
  <p>
    Click <a href={link}>here</a> to log in. Link expires in {expiresIn}.
  </p>
);

// Optional — subject shown in the sent email. Falls back to the
// template's filename stem if omitted. Can also be a function of `data`.
export const subject = "Your login link";
```

`export type Data` gives you compile-time checking on `data:` at the `send()` call site — real TypeScript, nothing Dune-specific enforces it at runtime. The component's props ARE `data` directly (`renderToString(h(Component, data))`) — there's no wrapping `{ data, site }` object passed in. **There is no automatic HTML-shell wrapping** — whatever your component returns is rendered as-is; if you need `<html><body>...` structure, write it yourself in the component.

Template resolution for `.tsx` needs an absolute filesystem path and currently derives it from `Deno.cwd()` (`templates.ts`'s `loadTemplate()`) rather than the `StorageAdapter`'s actual root — this only reliably works when the process's cwd is the site root (true for `dune dev`/`dune serve`, not guaranteed in every test harness).

### Markdown (`.email.md`)

```md
<!-- emails/welcome.email.md -->
# Welcome to {{site}}

Hi {{name}},

Thanks for signing up! Your account is ready.
```

`{{key}}` substitution pulls from `data:` and HTML-escapes the value first. Unknown keys are left as the literal `{{key}}` text. **The subject comes from the first `# Heading` line in the body** (extracted then stripped from the rendered output) — **not** from YAML frontmatter. There is no frontmatter parsing in the email-markdown path at all; a `---\nsubject: ...\n---` block at the top would just render as garbled Markdown, not set the subject.

### MDX (`.email.mdx`)

**`.mdx` email templates are rendered as plain Markdown, not compiled MDX/JSX.** `templates.ts` treats `.email.mdx` through the exact same `marked.parse()` path as `.email.md` — same `{{key}}` substitution, same heading-derived subject, no JSX support, no component imports. This is a known, explicit limitation in the source (`templates.ts`'s own comment: "treated as Markdown (noted limitation)"), not a difference from how `.mdx` content pages work. If you need real JSX in an email, use `.email.tsx`.

---

## Dev-mode interception — read this before assuming you're safe

**Provider selection does not check `DUNE_ENV` at all.** If `email:` in `site.yaml` names a real provider (`resend`, `smtp`, `postmark`, `sendgrid`) with valid credentials, `createEmailProvider()` returns that real provider and `send()` actually delivers — in development exactly as in production. Nothing in `createEmailProvider()`'s selection logic is dev-aware.

The only thing that's dev-aware is inside `ConsoleEmailProvider` itself — the provider you get when `email:` is omitted, or when the configured provider's credentials are missing. Only *that* provider, and only when `DUNE_ENV=dev`, additionally writes each message to `{runtimeDir}/dev-email/{id}.json` (default `.dune/admin/dev-email/`) so the admin panel can show it. `ConsoleEmailProvider` always logs to stdout regardless of `DUNE_ENV`; the file-write is the dev-only part.

In short: **"dev mode" does not intercept a properly-configured real provider.** If you have live Resend/SMTP/etc. credentials in `site.yaml` and run locally, real email goes to real recipients. To be safe locally, either don't configure real provider credentials in your local `site.yaml`, or explicitly point `email.provider: console` there.

Inspect intercepted emails (console-provider-with-`DUNE_ENV=dev` case only):

```sh
ls .dune/admin/dev-email/
cat .dune/admin/dev-email/1715598000000-ab12cd.json   # JSON, not HTML
```

Or via the admin panel at `/admin/email-preview` (requires `config.read`; both `/admin/api/email-preview` and `/admin/api/email-preview/{id}` 404 outside `DUNE_ENV=dev`).

---

## Common patterns

### Magic link (from auth system)

```ts
// Called internally by Dune's auth system — you don't wire this manually.
// POST /auth/magic/send has its own rate limiter; if you build a custom
// magic-link flow that calls send() directly, you own your own rate limiting.
```

### Digest from a background job

```ts
// jobs/weekly-digest.ts
import type { JobContext } from "@dune/core/jobs";

export const schedule = "0 9 * * MON";

export default async function handler(ctx: JobContext) {
  // ctx.content is a full DuneEngine, not a query API — there's no
  // ctx.content.find(). Filter/sort ctx.content.pages directly.
  const posts = ctx.content.pages
    .filter((p) => p.sourcePath.startsWith("02.blog/") && p.published)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 5);

  await ctx.email.send({
    to: "subscribers@example.com",
    template: "digest",
    data: { posts, siteUrl: ctx.config.site.url },
  });
}
```

`ctx.email` on `JobContext` is a real, pre-configured `EmailClient` (see `src/jobs/types.ts`) — this is the one context that gets one for free.

### Sending from a plugin hook or setup()

There is no ambient `email` on `HookContext` or `PluginApi`. Construct your own client in `setup()` and close over it — see the `dune-plugin-authoring` skill's "Send email on a content event" example. **There is no hook that fires on new-user creation** (no `onUserCreate`, no `onSiteUserCreated`, nothing in the real `HookEvent` union relates to user signup) — "send a welcome email when someone signs up" is not currently wireable through Dune's hook system at all. If you need this, you'd have to build it into your own auth flow / OAuth callback route directly, not via a hook.

---

## Attachments

Not supported — `EmailMessage`/`SendOptions` (`src/email/types.ts`, `src/email/client.ts`) have no `attachments` field at all, at any layer. Escape hatch: access the provider SDK directly.

```ts
import { Resend } from "npm:resend";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
await resend.emails.send({
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Invoice",
  html: "<p>See attached.</p>",
  attachments: [{ filename: "invoice.pdf", content: pdfBuffer }],
});
```

---

## Gotchas

**There is no `import { email } from "@dune/core"`.** Build a client with `createEmailClient()` + `createEmailProvider()`, or use `JobContext.email` inside a background job — the only place a pre-built client is handed to you.

**Template lookup order is `.tsx`, `.md`, `.mdx` — not tsx/mdx/md.** And `.mdx` templates don't actually get MDX/JSX treatment; they're rendered as plain Markdown, same as `.md`.

**Markdown template subject comes from the first `# Heading`, not frontmatter.** There's no YAML frontmatter parsing in the email-template path.

**TSX templates get no automatic HTML shell.** Whatever your component renders is the output — wrap in `<html><body>` yourself if you need a full document.

**`export type Data` is compile-time only.** Nothing at runtime enforces it — Dune doesn't validate `data:` against it.

**Dev mode does not block real sends.** `createEmailProvider()` never checks `DUNE_ENV` — only `ConsoleEmailProvider` (the fallback when no/invalid provider is configured) is dev-aware, and only for its file-logging behavior. A validly configured real provider sends for real regardless of `DUNE_ENV`. Don't rely on "I'm in dev mode" as a safety net if real credentials are present in config.

**Bounce and complaint handling is the provider's responsibility.** Dune has no webhook receiver for bounce/complaint events. If you need to handle them, add your own route and wire it to your provider's webhook config.

**Rate limiting on magic link send.** `POST /auth/magic/send` has a fixed-window rate limit owned by Dune (`src/auth/routes.ts`). If you're building a custom magic-link flow that calls `send()` directly, you are responsible for your own rate limiting.
