/**
 * `TemplateProps.config` is the narrow `TemplateConfig` slice, not the whole
 * `DuneConfig`: this is a compile-time contract, so the test is mostly the
 * `@ts-expect-error` lines. They fail `deno check` if a template can read
 * outside the slice again.
 */
import { assertEquals } from "@std/assert";
import type { DuneConfig, TemplateConfig } from "../../src/config/types.ts";
import type { TemplateProps } from "../../src/content/types.ts";

function themeName(props: Pick<TemplateProps, "config">): string {
  return props.config.theme.name;
}

function readOutsideTheSlice(props: Pick<TemplateProps, "config">) {
  // @ts-expect-error `system.content` is not part of the template contract
  void props.config.system.content;
  // @ts-expect-error `admin` is not part of the template contract
  void props.config.admin;
  // @ts-expect-error `plugins` is not part of the template contract
  void props.config.plugins;
}
void readOutsideTheSlice;

Deno.test("the full DuneConfig is assignable to TemplateConfig, and the documented reads type-check", () => {
  const full = {
    site: { title: "t", url: "https://x.test" },
    theme: { name: "demo", custom: { accent: "#fff" } },
    system: { languages: { supported: ["en"], default: "en", include_default_in_url: false } },
  } as unknown as DuneConfig;
  const narrowed: TemplateConfig = full; // compile-time: DuneConfig -> TemplateConfig
  assertEquals(themeName({ config: narrowed }), "demo");
  assertEquals(narrowed.theme.custom, { accent: "#fff" });
  assertEquals(narrowed.system.languages.supported, ["en"]);
  assertEquals(narrowed.site.url, "https://x.test");
});
