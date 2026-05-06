/** @jsxImportSource preact */
/** GET /admin/plugins — installed plugins list */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { hooks, prefix } = ctx.state.adminContext;
    const plugins = (hooks?.plugins() ?? []).map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
      author: p.author,
      hooks: Object.keys(p.hooks ?? {}),
      hasConfig: !!p.configSchema,
    }));
    return ctx.render(<PluginsRoute data={{ plugins, prefix }} />);
  },
};

export default function PluginsRoute(
  { data }: { data: { plugins: Array<Record<string, unknown>>; prefix: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>Plugins</h2>
        <a href={`${data.prefix}/marketplace?tab=plugins`} class="btn">Browse Marketplace</a>
      </div>
      {data.plugins.length === 0
        ? <p style="color:#718096;padding:2rem 0">No plugins installed.</p>
        : (
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Version</th><th>Description</th><th>Hooks</th></tr></thead>
            <tbody>
              {data.plugins.map((p) => (
                <tr key={String(p.name)}>
                  <td><strong>{String(p.name)}</strong></td>
                  <td>{String(p.version ?? "—")}</td>
                  <td>{String(p.description ?? "—")}</td>
                  <td style="font-size:12px;color:#718096">{(p.hooks as string[]).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
