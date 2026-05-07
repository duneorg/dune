/** @jsxImportSource preact */
/** GET /admin/submissions/:form — submissions list for a form */

import { h } from "preact";

import type { AdminState } from "../../../types.ts";
import type { FreshContext } from "fresh";
import { requirePermission } from "../../api/_utils.ts";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const denied = requirePermission(ctx, "submissions.read");
    if (denied) return denied;

    const { submissions, prefix } = ctx.state.adminContext;
    const form = ctx.params.form;
    if (!submissions) return new Response("Submissions not enabled", { status: 501 });
    const items = await submissions.list(form);
    return ctx.render(<SubmissionsFormRoute data={{ form, items, prefix }} />);
  },
};

export default function SubmissionsFormRoute(
  { data }: { data: { form: string; items: unknown[]; prefix: string } },
) {
  return (
    <div>
      <div class="section-header"><h2>Submissions — {data.form}</h2></div>
      {(data.items as Array<Record<string, unknown>>).length === 0
        ? <p style="color:#718096;padding:2rem 0">No submissions yet.</p>
        : (
          <table class="admin-table">
            <thead><tr><th>ID</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {(data.items as Array<{ id: string; createdAt: number; status: string }>).map((s) => (
                <tr key={s.id}>
                  <td><code style="font-size:12px">{s.id}</code></td>
                  <td style="font-size:13px">{new Date(s.createdAt).toLocaleString()}</td>
                  <td><span class="badge">{s.status}</span></td>
                  <td><a href={`${data.prefix}/submissions/${data.form}/${s.id}`} class="btn btn-sm">View</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
