/**
 * dune config:* — Configuration inspection commands.
 */

import { createStorage } from "../storage/mod.ts";
import { loadConfig } from "../config/mod.ts";
import { validateConfig } from "../config/validator.ts";

export interface ConfigCommandOptions {
  /** Output machine-parseable JSON instead of human-readable text. */
  json?: boolean;
}

export const configCommands = {
  /**
   * dune config:show — Display merged config with source annotations.
   */
  async show(root: string, options: ConfigCommandOptions = {}) {
    const storage = createStorage({ rootDir: root });
    const config = await loadConfig({ storage, rootDir: root, skipConfigTs: false });

    if (options.json) {
      const output = {
        site: {
          title: config.site.title,
          description: config.site.description,
          url: config.site.url,
          authorName: config.site.author.name,
          taxonomies: config.site.taxonomies,
        },
        system: {
          contentDir: config.system.content.dir,
          cacheEnabled: config.system.cache.enabled,
          cacheDriver: config.system.cache.driver,
          cacheLifetime: config.system.cache.lifetime,
          debug: config.system.debug,
          timezone: config.system.timezone,
        },
        theme: {
          name: config.theme.name,
          parent: config.theme.parent ?? null,
        },
        plugins: Object.keys(config.plugins),
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    console.log("🏜️  Dune — configuration\n");

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
  async validate(root: string, options: ConfigCommandOptions = {}) {
    const storage = createStorage({ rootDir: root });
    const config = await loadConfig({ storage, rootDir: root, skipConfigTs: false });
    const errors = validateConfig(config);

    if (options.json) {
      const output = {
        valid: errors.length === 0,
        errors,
      };
      console.log(JSON.stringify(output, null, 2));
      if (errors.length > 0) Deno.exit(1);
      return;
    }

    console.log("🏜️  Dune — validating configuration...\n");

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
