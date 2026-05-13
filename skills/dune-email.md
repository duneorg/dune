# Skill: Dune Email

Transactional email through a single `email.send()` call. Dune owns the interface and template rendering; the delivery provider is swappable via config. In development, emails are never sent — they're written to disk and visible in the admin panel.

---

## Call surface

```ts
import { email } from "@dune/core";

await email.send({
  to: "user@example.com",
  subject: "Your magic link",
  template: "magic-link",      // resolves emails/magic-link.email.{tsx,mdx,md}
  data: { link, expiresIn: "15 minutes" },
});
```

`to` accepts a string or `string[]`. `template` is the base filename without the `.email.{ext}` suffix. Dune resolves by searching for `emails/<name>.email.tsx`, then `.mdx`, then `.md` — use only one format per template name.

Plain-text fallback is auto-generated from the rendered HTML. You do not need a separate text template.

---

## Provider config

```yaml
# site.yaml
email:
  from: "My Site <hello@example.com>"
  provider: resend               # or: smtp, postmark, sendgrid
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
    user: "${SMTP_USER}"
    password: "${SMTP_PASS}"
```

No provider config is needed in development — dev-mode interception is automatic.

---

## Template formats

Templates live in `emails/` at the project root, one file per email type.

### TSX (`.email.tsx`) — structural, fully typed

```tsx
// emails/magic-link.email.tsx
export type Data = { link: string; expiresIn: string };

export default ({ link, expiresIn }: Data) => (
  <p>
    Click <a href={link}>here</a> to log in. Link expires in {expiresIn}.
  </p>
);
```

`export type Data` types the `data:` field in `email.send()` — TypeScript catches mismatches at the call site. Dune wraps a fragment root in an HTML shell automatically. If the root element is `<html>`, it is used as-is.

```tsx
// Full HTML control when needed
export type Data = { name: string; items: string[] };

export default ({ name, items }: Data) => (
  <html>
    <body style="font-family: sans-serif;">
      <p>Hi {name},</p>
      <ul>{items.map(i => <li>{i}</li>)}</ul>
    </body>
  </html>
);
```

### MDX (`.email.mdx`) — prose-heavy, non-developer editable

```mdx
Hi {name},

Here are this week's top posts:

{posts.map(p => `- [${p.title}](${siteUrl}${p.route})`).join('\n')}

[Unsubscribe]({unsubscribeUrl})
```

`@mdx-js/mdx` compiles MDX to JSX — same rendering pipeline as TSX. Good for emails where copy is the main thing and non-developers need to edit it. No `export type Data` — `data:` is untyped.

### Markdown (`.email.md`) — simplest, no JSX

```md
Hi {{name}},

Click [here]({{link}}) to log in. Link expires in {{expiresIn}}.
```

Dune does `{{key}}` substitution from `data:`, then renders Markdown to HTML. No JSX toolchain. No type safety. Best for simple transactional emails with no conditional logic.

---

## Dev-mode interception

In development, `email.send()` writes to `{runtimeDir}/dev-email/` as rendered `.html` files instead of sending. No provider credentials are needed.

View intercepted emails at `/admin/email-preview` — shows subject, recipient, timestamp, and rendered HTML. **Clears on restart.** This is a dev tool, not a sent-mail log.

To verify template rendering without a browser, inspect the files directly:

```sh
ls .dune/dev-email/
open .dune/dev-email/magic-link-2026-05-13T09-00-00.html
```

---

## Common patterns

### Magic link (from auth system)

```ts
// Called internally by Dune's auth system — you don't wire this manually.
// If implementing a custom flow:
await email.send({
  to: user.email,
  subject: "Your login link",
  template: "magic-link",
  data: { link: magicLinkUrl, expiresIn: "15 minutes" },
});
```

### Welcome email on first OAuth login

```ts
// In a plugin hook:
hooks: {
  onUserCreate: async (ctx, user) => {
    await ctx.email.send({
      to: user.email,
      subject: `Welcome to ${ctx.config.site.name}`,
      template: "welcome",
      data: { name: user.name ?? user.email },
    });
  },
}
```

### Digest from a background job

```ts
// jobs/weekly-digest.ts
export const schedule = "0 9 * * MON";

export default async function handler(ctx: JobContext) {
  const posts = await ctx.content.find({ type: "post", limit: 5 });
  await ctx.email.send({
    to: "subscribers@example.com",
    subject: "Weekly digest",
    template: "digest",
    data: { posts, siteUrl: ctx.config.site.url },
  });
}
```

---

## Attachments

Not supported in v1. Escape hatch: access the provider SDK directly.

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

**`template` is the base name only.** `template: "magic-link"` — not `"magic-link.email.tsx"`, not `"emails/magic-link"`. Dune appends the extension and directory.

**`export type Data` is only meaningful in TSX templates.** MDX and MD templates have no type-checked `data:`. If type safety on `data:` matters, use `.email.tsx`.

**Fragment root gets an HTML shell; `<html>` root does not.** If your TSX template returns `<p>...</p>`, Dune wraps it in a full HTML document. If it returns `<html>...</html>`, Dune uses it as-is. Don't return a bare fragment if you need full HTML control — return `<html>`.

**MD uses `{{key}}`, not `{key}`.** Curly braces without doubling are not interpolated in Markdown templates. `{link}` renders literally; `{{link}}` is substituted.

**Dev mode never sends.** `email.send()` in development always writes to disk regardless of provider config. If you need to test real delivery, set `DUNE_ENV=production` locally — but be aware this sends real emails to real addresses.

**Bounce and complaint handling is the provider's responsibility.** Dune has no webhook receiver for bounce/complaint events. If you need to handle them, add a `POST /webhooks/email` route in your project and wire it to your provider's webhook config.

**Rate limiting on magic link send.** `POST /auth/magic/send` has a fixed-window rate limit owned by Dune. If you're building a custom magic link flow that calls `email.send()` directly, you are responsible for your own rate limiting.
