/** @jsxImportSource preact */
/** GET /admin/metrics — performance metrics dashboard */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import MetricsDashboard from "../../islands/MetricsDashboard.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { auth, prefix } = getAdminContext();
    if (!auth.hasPermission(ctx.state.auth, "config.read")) {
      return new Response("Forbidden", { status: 403 });
    }
    return ctx.render(<MetricsRoute data={{ prefix }} />);
  },
};

export default function MetricsRoute({ data }: { data: { prefix: string } }) {
  return (
    <div>
      <div class="section-header"><h2>Performance Metrics</h2></div>
      <MetricsDashboard prefix={data.prefix} />
    </div>
  );
}
