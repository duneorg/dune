/** @jsxImportSource preact */
/** GET /admin/media — media library */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import { getAdminContext } from "../../context.ts";
import MediaLibrary from "../../islands/MediaLibrary.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    return ctx.render(<MediaRoute data={{ prefix: getAdminContext().prefix }} />);
  },
};

export default function MediaRoute({ data }: { data: { prefix: string } }) {
  return (
    <div>
      <div class="section-header"><h2>Media Library</h2></div>
      <MediaLibrary prefix={data.prefix} />
    </div>
  );
}
