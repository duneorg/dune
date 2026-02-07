/**
 * Tests for config validator.
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateConfig } from "../../src/config/validator.ts";
import { DEFAULT_CONFIG } from "../../src/config/defaults.ts";
import type { DuneConfig } from "../../src/config/types.ts";

/** Clone default config for modification in tests */
function cloneConfig(): DuneConfig {
  return structuredClone(DEFAULT_CONFIG);
}

Deno.test("validator: default config is valid", () => {
  const errors = validateConfig(DEFAULT_CONFIG);
  assertEquals(errors.length, 0);
});

Deno.test("validator: catches empty site.title", () => {
  const config = cloneConfig();
  config.site.title = "";
  const errors = validateConfig(config);
  assertEquals(errors.some((e) => e.includes("site.title")), true);
});

Deno.test("validator: catches invalid site.url", () => {
  const config = cloneConfig();
  config.site.url = "not-a-url";
  const errors = validateConfig(config);
  assertEquals(errors.some((e) => e.includes("site.url")), true);
});

Deno.test("validator: catches non-array taxonomies", () => {
  const config = cloneConfig();
  // @ts-ignore: testing invalid input
  config.site.taxonomies = "category, tag";
  const errors = validateConfig(config);
  assertEquals(errors.some((e) => e.includes("site.taxonomies")), true);
  // Should include a suggestion
  assertEquals(errors.some((e) => e.includes("Did you mean")), true);
});

Deno.test("validator: catches invalid cache.driver", () => {
  const config = cloneConfig();
  // @ts-ignore: testing invalid input
  config.system.cache.driver = "redis";
  const errors = validateConfig(config);
  assertEquals(errors.some((e) => e.includes("system.cache.driver")), true);
});

Deno.test("validator: catches negative cache.lifetime", () => {
  const config = cloneConfig();
  config.system.cache.lifetime = -1;
  const errors = validateConfig(config);
  assertEquals(errors.some((e) => e.includes("system.cache.lifetime")), true);
});

Deno.test("validator: catches invalid image quality", () => {
  const config = cloneConfig();
  config.system.images.default_quality = 150;
  const errors = validateConfig(config);
  assertEquals(errors.some((e) => e.includes("system.images.default_quality")), true);
});

Deno.test("validator: catches default language not in supported list", () => {
  const config = cloneConfig();
  config.system.languages.default = "fr";
  const errors = validateConfig(config);
  assertEquals(errors.some((e) => e.includes("system.languages.default")), true);
});

Deno.test("validator: catches empty theme.name", () => {
  const config = cloneConfig();
  config.theme.name = "";
  const errors = validateConfig(config);
  assertEquals(errors.some((e) => e.includes("theme.name")), true);
});

Deno.test("validator: valid custom config passes", () => {
  const config = cloneConfig();
  config.site.title = "My Site";
  config.site.url = "https://example.com";
  config.system.debug = true;
  config.system.languages.supported = ["en", "fr"];
  config.system.languages.default = "fr";
  const errors = validateConfig(config);
  assertEquals(errors.length, 0);
});
