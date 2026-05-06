/** @jsxImportSource preact */
/** GET /admin/flex — flex object types list */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { flex, prefix } = getAdminContext();
    const schemas = flex ? Object.entries(await flex.loadSchemas()).map(([type, s]) => ({ type, label: s.title })) : [];
    return ctx.render(<FlexRoute data={{ schemas, prefix }} />);
  },
};

export default function FlexRoute(
  { data }: { data: { schemas: Array<{ type: string; label?: string }>; prefix: string } },
) {
  return (
    <div>
      <div class="section-header"><h2>Flex Objects</h2></div>
      {data.schemas.length === 0
        ? <p style="color:#718096;padding:2rem 0">No flex object types defined.</p>
        : (
          <table class="admin-table">
            <thead><tr><th>Type</th><th>Label</th><th></th></tr></thead>
            <tbody>
              {data.schemas.map((s) => (
                <tr key={s.type}>
                  <td><code>{s.type}</code></td>
                  <td>{s.label ?? s.type}</td>
                  <td><a href={`${data.prefix}/flex/${s.type}`} class="btn btn-sm">View records</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </div>
  );
}
