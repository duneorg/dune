/** @jsxImportSource preact */
/** GET /admin/ — dashboard */

import { h } from "preact";

import type { AdminState } from "../types.ts";
import { getAdminContext } from "../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { engine, prefix } = getAdminContext();
    const pages = engine.pages;
    const stats = {
      total: pages.length,
      published: pages.filter((p) => p.published).length,
      draft: pages.filter((p) => !p.published).length,
      md: pages.filter((p) => p.format === "md").length,
      mdx: pages.filter((p) => p.format === "mdx").length,
      tsx: pages.filter((p) => p.format === "tsx").length,
    };
    const recent = pages.slice(0, 10).map((p) => ({
      route: p.route,
      title: p.title,
      format: p.format,
      published: p.published,
    }));
    return ctx.render(<Dashboard data={{ stats, recent, prefix }} />);
  },
};

export default function Dashboard(
  { data }: { data: { stats: Record<string, number>; recent: Array<Record<string, unknown>>; prefix: string } },
) {
  const { stats, recent, prefix } = data;
  return (
    <div>
      <div class="section-header">
        <h2>Dashboard</h2>
        <a href={`${prefix}/pages?action=new`} class="btn btn-primary">New page</a>
      </div>
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-number">{stats.total}</div><div class="stat-label">Total pages</div></div>
        <div class="stat-card"><div class="stat-number">{stats.published}</div><div class="stat-label">Published</div></div>
        <div class="stat-card"><div class="stat-number">{stats.draft}</div><div class="stat-label">Drafts</div></div>
        <div class="stat-card"><div class="stat-number">{stats.md}</div><div class="stat-label">Markdown</div></div>
        <div class="stat-card"><div class="stat-number">{stats.mdx}</div><div class="stat-label">MDX</div></div>
        <div class="stat-card"><div class="stat-number">{stats.tsx}</div><div class="stat-label">TSX</div></div>
      </div>
      <h3 style="margin-bottom:12px;font-size:16px;font-weight:600">Recent pages</h3>
      <table class="admin-table">
        <thead><tr><th>Route</th><th>Title</th><th>Format</th><th>Status</th></tr></thead>
        <tbody>
          {recent.map((p) => (
            <tr key={String(p.route)}>
              <td><a href={`${prefix}/pages/edit?path=${encodeURIComponent(String(p.route))}`}><code>{String(p.route)}</code></a></td>
              <td>{String(p.title || "—")}</td>
              <td><span class={`badge badge-${p.format}`}>{String(p.format)}</span></td>
              <td>{p.published ? "Published" : "Draft"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
