/** @jsxImportSource preact */
/** GET /admin/audit — audit log viewer */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { auditLogger, auth, prefix } = ctx.state.adminContext;
    if (!auth.hasPermission(ctx.state.auth, "config.read")) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!auditLogger) {
      return ctx.render(<AuditRoute data={{ entries: [], disabled: true, prefix }} />);
    }
    const eventFilter = ctx.url.searchParams.get("event") ?? "";
    const q: import("../.././../audit/mod.ts").AuditQuery = { limit: 50 };
    if (eventFilter) q.event = eventFilter as import("../../../audit/mod.ts").AuditEventType;
    const result = await auditLogger.query(q);
    return ctx.render(<AuditRoute data={{ entries: result.entries, disabled: false, eventFilter, prefix }} />);
  },
};

export default function AuditRoute(
  { data }: { data: { entries: unknown[]; disabled: boolean; eventFilter?: string; prefix: string } },
) {
  if (data.disabled) {
    return (
      <div>
        <div class="section-header"><h2>Audit Log</h2></div>
        <p style="color:#718096;padding:2rem 0">Audit logging is not enabled.</p>
      </div>
    );
  }
  return (
    <div>
      <div class="section-header"><h2>Audit Log</h2></div>
      <table class="admin-table">
        <thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Target</th><th>IP</th><th>Outcome</th></tr></thead>
        <tbody>
          {(data.entries as Array<Record<string, unknown>>).map((e, i) => (
            <tr key={i}>
              <td style="white-space:nowrap;font-size:12px;color:#718096">{String(e.ts ?? "").replace("T", " ").slice(0, 19)}</td>
              <td><code style="font-size:12px">{String(e.event ?? "")}</code></td>
              <td>{(e.actor as { username?: string })?.username ?? "—"}</td>
              <td style="font-size:12px">{String(e.target ?? "—")}</td>
              <td style="font-size:12px;color:#718096">{String(e.ip ?? "—")}</td>
              <td><span class={`badge ${e.outcome === "success" ? "badge-success" : "badge-failure"}`}>{String(e.outcome ?? "")}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
