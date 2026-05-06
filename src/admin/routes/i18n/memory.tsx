/** @jsxImportSource preact */
/** GET /admin/i18n/memory — translation memory */

import { h } from "preact";

import type { AdminState } from "../../types.ts";
import TranslationMemory from "../../islands/TranslationMemory.tsx";
import type { FreshContext } from "fresh";

export const handler = {
  GET(ctx: FreshContext<AdminState>) {
    const { config, prefix } = ctx.state.adminContext;
    const supported = config.system.languages?.supported ?? [];
    return ctx.render(<TranslationMemoryRoute data={{ supported, prefix }} />);
  },
};

export default function TranslationMemoryRoute(
  { data }: { data: { supported: string[]; prefix: string } },
) {
  return (
    <div>
      <div class="section-header">
        <h2>Translation Memory</h2>
        <a href={`${data.prefix}/i18n`} class="btn">Back</a>
      </div>
      <TranslationMemory prefix={data.prefix} supportedLanguages={data.supported} />
    </div>
  );
}
