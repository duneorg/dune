/** @jsxImportSource preact */
/** GET /admin/config — site config editor */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import ConfigEditor from "../../islands/ConfigEditor.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { auth, prefix } = getAdminContext();
    if (!auth.hasPermission(ctx.state.auth, "config.read")) {
      return new Response("Forbidden", { status: 403 });
    }
    return ctx.render(<ConfigRoute data={{ prefix }} />);
  },
};

export default function ConfigRoute({ data }: { data: { prefix: string } }) {
  return (
    <div>
      <div class="section-header"><h2>Configuration</h2></div>
      <ConfigEditor prefix={data.prefix} />
    </div>
  );
}
