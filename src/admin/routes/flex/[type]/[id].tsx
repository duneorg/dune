/** @jsxImportSource preact */
/** GET /admin/flex/:type/:id — flex record editor (also handles "new") */

import { h } from "preact";

import type { AdminState } from "../../../types.ts";
import { getAdminContext } from "../../../context.ts";
import FlexEditor from "../../../islands/FlexEditor.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { flex, prefix } = getAdminContext();
    const { type, id } = ctx.params;
    if (!flex) return new Response("Flex objects not enabled", { status: 501 });
    const schema = (await flex.loadSchemas())[type] ?? null;
    if (!schema) return new Response("Type not found", { status: 404 });
    const record = id === "new" ? null : await flex.get(type, id);
    if (id !== "new" && !record) return new Response("Record not found", { status: 404 });
    return ctx.render(<FlexEditorRoute data={{ type, id, schema, record, prefix }} />);
  },
};

export default function FlexEditorRoute(
  { data }: { data: { type: string; id: string; schema: unknown; record: unknown; prefix: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>{data.id === "new" ? `New ${data.type}` : `Edit ${data.type}`}</h2>
        <a href={`${data.prefix}/flex/${data.type}`} class="btn">Back</a>
      </div>
      <FlexEditor
        type={data.type}
        id={data.id}
        schema={data.schema}
        record={data.record}
        prefix={data.prefix}
      />
    </div>
  );
}
