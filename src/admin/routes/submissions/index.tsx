/** @jsxImportSource preact */
/** GET /admin/submissions — redirect to first form or show empty state */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { submissions, prefix } = ctx.state.adminContext;
    if (!submissions) return ctx.render(<SubmissionsRoute data={{ forms: [], prefix }} />);
    const forms = await submissions.listForms();
    if (forms.length > 0) {
      return new Response(null, { status: 302, headers: { Location: `${prefix}/submissions/${forms[0]}` } });
    }
    return ctx.render(<SubmissionsRoute data={{ forms, prefix }} />);
  },
};

export default function SubmissionsRoute(
  { data }: { data: { forms: string[]; prefix: string } },
) {
  return (
    <div>
      <div class="section-header"><h2>Submissions</h2></div>
      <p style="color:#718096;padding:2rem 0">No form submissions yet.</p>
    </div>
  );
}
