/** GET /admin/submissions/:form/:id/files/:filename */


import type { AdminState } from "../../../../../types.ts";
import { getAdminContext } from "../../../../../context.ts";
import { basename } from "@std/path";
import type { FreshContext } from "fresh";

export const handler = {
  async GET(ctx: FreshContext<AdminState>) {
    const { submissions, storage, config } = getAdminContext();
    const { form, id } = ctx.params;
    const filename = basename(decodeURIComponent(ctx.params.filename));

    const dataDir = config.admin?.dataDir ?? "data";
    const storagePath = `${dataDir}/uploads/${form}/${id}/${filename}`;

    try {
      const data = await storage.read(storagePath);
      const sub = await submissions?.get(form, id);
      const fileMeta = sub?.files?.find((f) => f.name === filename);
      const contentType = fileMeta?.contentType ?? "application/octet-stream";

      return new Response(data.buffer as ArrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
          "Content-Length": String(data.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("File not found", { status: 404 });
    }
  },
};
