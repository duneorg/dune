/** @jsxImportSource preact */
/** GET /admin/flex/:type — flex records list */

import { h } from "preact";

import type { AdminState } from "../../../types.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { flex, prefix } = ctx.state.adminContext;
    const type = ctx.params.type;
    if (!flex) return new Response("Flex objects not enabled", { status: 501 });
    const schema = (await flex.loadSchemas())[type] ?? null;
    if (!schema) return new Response("Type not found", { status: 404 });
    const records = await flex.list(type);
    return ctx.render(<FlexTypeRoute data={{ type, schema, records, prefix }} />);
  },
};

export default function FlexTypeRoute(
  { data }: { data: { type: string; schema: unknown; records: unknown[]; prefix: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>{data.type}</h2>
        <a href={`${data.prefix}/flex/${data.type}/new`} class="btn btn-primary">New record</a>
      </div>
      <table class="admin-table">
        <thead><tr><th>ID</th><th>Actions</th></tr></thead>
        <tbody>
          {(data.records as Array<{ id: string }>).map((r) => (
            <tr key={r.id}>
              <td><code>{r.id}</code></td>
              <td><a href={`${data.prefix}/flex/${data.type}/${r.id}`} class="btn btn-sm">Edit</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
