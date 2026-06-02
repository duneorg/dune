/** @jsxImportSource preact */
/** GET /admin/email-preview — dev-mode intercepted email viewer */

import { h } from "preact";
import { join } from "@std/path";
import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";

interface EmailMeta {
  id: string;
  to: string;
  from: string | null;
  subject: string;
  timestamp: number;
}

interface PageData {
  isDev: boolean;
  prefix: string;
  emails: EmailMeta[];
  selected: { id: string; subject: string; to: string; timestamp: number; html: string } | null;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString();
}

export default function EmailPreviewPage({ data }: { data: PageData }) {
  const { isDev, prefix, emails, selected } = data;

  if (!isDev) {
    return (
      <div>
        <div class="section-header"><h2>Email Preview</h2></div>
        <p style="color:#718096;padding:2rem 0">
          Email preview is only available in development mode (DUNE_ENV=dev).
        </p>
      </div>
    );
  }

  return (
    <div>
      <div class="section-header">
        <h2>
          Email Preview{" "}
          <span style="font-size:0.75rem;font-weight:400;color:#718096;margin-left:0.5rem">
            dev only
          </span>
        </h2>
      </div>

      {emails.length === 0 && (
        <p style="color:#718096;padding:2rem 0">
          No intercepted emails yet. Emails sent via the console provider will appear here.
        </p>
      )}

      {emails.length > 0 && (
        <div style="display:grid;grid-template-columns:320px 1fr;gap:1.5rem;align-items:start">
          {/* Email list */}
          <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
            {emails.map((email) => (
              <a
                key={email.id}
                href={`${prefix}/email-preview?id=${email.id}`}
                style={`display:block;padding:0.75rem 1rem;border-bottom:1px solid #e2e8f0;text-decoration:none;color:inherit;background:${
                  selected?.id === email.id ? "#ebf8ff" : "white"
                }`}
              >
                <div style="font-weight:500;font-size:0.875rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  {email.subject || "(no subject)"}
                </div>
                <div style="font-size:0.75rem;color:#718096;margin-top:0.2rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                  {email.to}
                </div>
                <div style="font-size:0.7rem;color:#a0aec0;margin-top:0.1rem">
                  {formatDate(email.timestamp)}
                </div>
              </a>
            ))}
          </div>

          {/* Preview pane */}
          <div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;min-height:400px">
            {selected
              ? (
                <div>
                  <div style="padding:1rem;border-bottom:1px solid #e2e8f0;background:#f7fafc">
                    <div style="font-weight:600">{selected.subject}</div>
                    <div style="font-size:0.8rem;color:#718096;margin-top:0.25rem">
                      To: {selected.to}
                    </div>
                    <div style="font-size:0.75rem;color:#a0aec0">
                      {formatDate(selected.timestamp)}
                    </div>
                  </div>
                  <iframe
                    srcDoc={selected.html}
                    style="width:100%;height:500px;border:0;display:block"
                    sandbox=""
                  />
                </div>
              )
              : (
                <div style="display:flex;align-items:center;justify-content:center;height:400px;color:#a0aec0;font-size:0.875rem">
                  Select an email to preview
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}

export const handler = {
  async GET(ctx: FreshContext<AdminState>): Promise<Response> {
    const { prefix } = ctx.state.adminContext;
    const runtimeDir = ctx.state.adminContext.config.admin?.runtimeDir ?? ".dune/admin";

    if (Deno.env.get("DUNE_ENV") !== "dev") {
      return ctx.render(
        <EmailPreviewPage data={{ isDev: false, prefix, emails: [], selected: null }} />,
      );
    }

    const devEmailDir = join(runtimeDir, "dev-email");
    const emails: EmailMeta[] = [];

    try {
      for await (const entry of Deno.readDir(devEmailDir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        try {
          const raw = await Deno.readTextFile(join(devEmailDir, entry.name));
          const rec = JSON.parse(raw);
          emails.push({
            id: rec.id,
            to: rec.to,
            from: rec.from ?? null,
            subject: rec.subject,
            timestamp: rec.timestamp,
          });
        } catch { /* skip malformed */ }
      }
    } catch { /* directory doesn't exist yet */ }

    emails.sort((a, b) => b.timestamp - a.timestamp);

    // Load the selected email's HTML when ?id= is provided.
    // Validate id against the same allowlist as the API route ([name]/run.ts):
    // only word characters and hyphens. This prevents path traversal before
    // the value is embedded in a filesystem path (e.g. "../../data/users/x").
    const selectedIdRaw = ctx.url.searchParams.get("id");
    const selectedId = selectedIdRaw && /^[\w-]+$/.test(selectedIdRaw) ? selectedIdRaw : null;
    let selected: PageData["selected"] = null;
    if (selectedId) {
      try {
        const raw = await Deno.readTextFile(
          join(devEmailDir, `${selectedId}.json`),
        );
        const rec = JSON.parse(raw);
        selected = {
          id: rec.id,
          subject: rec.subject,
          to: rec.to,
          timestamp: rec.timestamp,
          html: rec.html,
        };
      } catch { /* not found */ }
    }

    return ctx.render(
      <EmailPreviewPage data={{ isDev: true, prefix, emails, selected }} />,
    );
  },
};
