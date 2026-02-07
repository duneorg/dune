/**
 * dune config:* — Configuration inspection commands.
 */

import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { validateConfig } from "../config/validator.ts";

export const configCommands = {
  /**
   * dune config:show — Display merged config with source annotations.
   */
  async show(root: string) {
    console.log("🏜️  Dune — configuration\n");

    const storage = createStorage({ rootDir: root });
    const config = await loadConfig({ storage, rootDir: root, skipConfigTs: false });

    // Format config for display
    printSection("Site", {
      "title": config.site.title,
      "description": config.site.description,
      "url": config.site.url,
      "author.name": config.site.author.name,
      "taxonomies": config.site.taxonomies.join(", "),
    });

    printSection("System", {
      "content.dir": config.system.content.dir,
      "cache.enabled": String(config.system.cache.enabled),
      "cache.driver": config.system.cache.driver,
      "cache.lifetime": `${config.system.cache.lifetime}s`,
      "cache.check": config.system.cache.check,
      "debug": String(config.system.debug),
      "timezone": config.system.timezone,
    });

    printSection("Theme", {
      "name": config.theme.name,
      ...(config.theme.parent ? { "parent": config.theme.parent } : {}),
    });

    if (Object.keys(config.plugins).length > 0) {
      printSection("Plugins", Object.fromEntries(
        Object.keys(config.plugins).map((k) => [k, "enabled"]),
      ));
    }
  },

  /**
   * dune config:validate — Validate all config files.
   */
  async validate(root: string) {
    console.log("🏜️  Dune — validating configuration...\n");

    const storage = createStorage({ rootDir: root });
    const config = await loadConfig({ storage, rootDir: root, skipConfigTs: false });
    const errors = validateConfig(config);

    if (errors.length === 0) {
      console.log("  ✅ All configuration is valid");
    } else {
      console.log(`  ⚠️  ${errors.length} issue(s) found:\n`);
      for (const err of errors) {
        console.log(`  ✗ ${err}`);
      }
    }
  },
};

function printSection(name: string, entries: Record<string, string>) {
  console.log(`  ─── ${name} ───`);
  const maxKey = Math.max(...Object.keys(entries).map((k) => k.length));
  for (const [key, value] of Object.entries(entries)) {
    console.log(`  ${key.padEnd(maxKey + 2)}${value}`);
  }
  console.log();
}
