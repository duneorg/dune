/**
 * Config validator — lightweight schema validation with actionable errors.
 *
 * Produces human-readable error messages that tell the user what to do:
 *   → site.taxonomies must be an array of strings
 *   → Got: "category, tag" (string)
 *   → Did you mean: ["category", "tag"]?
 */

import type { DuneConfig, SiteConfig, SystemConfig, ThemeConfig } from "./types.ts";

/** A single validation error with path and message. */
export interface ValidationError {
  path: string;
  message: string;
  got?: unknown;
  suggestion?: string;
}

/**
 * Validate a DuneConfig and return an array of human-readable error strings.
 * Returns an empty array if config is valid.
 */
export function validateConfig(config: DuneConfig): string[] {
  const errors: ValidationError[] = [];

  validateSite(config.site, errors);
  validateSystem(config.system, errors);
  validateTheme(config.theme, errors);
  validatePlugins(config.plugins, errors);
  validateAdmin(config.admin, errors);

  return errors.map(formatError);
}

// --- Admin validation ---

const ADMIN_PATH_RE = /^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/;

function validateAdmin(
  admin: DuneConfig["admin"],
  errors: ValidationError[],
): void {
  if (!admin) return;
  if (admin.path !== undefined) {
    if (typeof admin.path !== "string") {
      errors.push({
        path: "admin.path",
        message: "must be a string starting with a leading slash",
        got: admin.path,
      });
    } else if (!ADMIN_PATH_RE.test(admin.path)) {
      // The middleware uses pathname.startsWith(admin.path) and slices on
      // its length. Anything that isn't an unambiguous absolute path with
      // safe characters and no trailing slash will desync that logic and
      // either lock users out or expose admin routes outside the prefix.
      errors.push({
        path: "admin.path",
        message: 'must start with "/", contain only [a-zA-Z0-9_-] segments, and have no trailing slash (e.g. "/admin", "/cms/admin")',
        got: admin.path,
      });
    }
  }
}

// --- Site validation ---

function validateSite(site: SiteConfig, errors: ValidationError[]): void {
  if (!site) {
    errors.push({ path: "site", message: "site configuration is required" });
    return;
  }

  if (typeof site.title !== "string" || !site.title.trim()) {
    errors.push({
      path: "site.title",
      message: "must be a non-empty string",
      got: site.title,
    });
  }

  if (typeof site.url !== "string") {
    errors.push({
      path: "site.url",
      message: "must be a string URL",
      got: site.url,
    });
  } else if (site.url && !isValidUrl(site.url)) {
    errors.push({
      path: "site.url",
      message: "must be a valid URL",
      got: site.url,
      suggestion: `Did you mean "https://${site.url}"?`,
    });
  }

  if (!Array.isArray(site.taxonomies)) {
    errors.push({
      path: "site.taxonomies",
      message: "must be an array of strings",
      got: site.taxonomies,
      suggestion: typeof site.taxonomies === "string"
        ? `Did you mean: ${JSON.stringify((site.taxonomies as string).split(/[,\s]+/).filter(Boolean))}?`
        : undefined,
    });
  } else {
    for (let i = 0; i < site.taxonomies.length; i++) {
      if (typeof site.taxonomies[i] !== "string") {
        errors.push({
          path: `site.taxonomies[${i}]`,
          message: "each taxonomy must be a string",
          got: site.taxonomies[i],
        });
      }
    }
  }

  if (site.author && typeof site.author !== "object") {
    errors.push({
      path: "site.author",
      message: "must be an object with at least a 'name' field",
      got: site.author,
    });
  }

  validateRecord("site.routes", site.routes, "string", errors);
  validateRecord("site.redirects", site.redirects, "string", errors);
  validateRecord("site.metadata", site.metadata, "string", errors);
}

// --- System validation ---

function validateSystem(system: SystemConfig, errors: ValidationError[]): void {
  if (!system) {
    errors.push({ path: "system", message: "system configuration is required" });
    return;
  }

  // content
  if (system.content) {
    if (typeof system.content.dir !== "string" || !system.content.dir.trim()) {
      errors.push({
        path: "system.content.dir",
        message: "must be a non-empty string (content directory path)",
        got: system.content.dir,
      });
    }

    if (system.content.markdown) {
      for (const key of ["extra", "auto_links", "auto_url_links"] as const) {
        if (typeof system.content.markdown[key] !== "boolean") {
          errors.push({
            path: `system.content.markdown.${key}`,
            message: "must be a boolean",
            got: system.content.markdown[key],
          });
        }
      }
    }
  }

  // cache
  if (system.cache) {
    const validDrivers = ["memory", "filesystem", "kv"];
    if (!validDrivers.includes(system.cache.driver)) {
      errors.push({
        path: "system.cache.driver",
        message: `must be one of: ${validDrivers.join(", ")}`,
        got: system.cache.driver,
      });
    }

    if (typeof system.cache.lifetime !== "number" || system.cache.lifetime < 0) {
      errors.push({
        path: "system.cache.lifetime",
        message: "must be a non-negative number (seconds)",
        got: system.cache.lifetime,
      });
    }

    const validChecks = ["file", "hash", "none"];
    if (!validChecks.includes(system.cache.check)) {
      errors.push({
        path: "system.cache.check",
        message: `must be one of: ${validChecks.join(", ")}`,
        got: system.cache.check,
      });
    }
  }

  // images
  if (system.images) {
    if (
      typeof system.images.default_quality !== "number" ||
      system.images.default_quality < 1 ||
      system.images.default_quality > 100
    ) {
      errors.push({
        path: "system.images.default_quality",
        message: "must be a number between 1 and 100",
        got: system.images.default_quality,
      });
    }

    if (!Array.isArray(system.images.allowed_sizes)) {
      errors.push({
        path: "system.images.allowed_sizes",
        message: "must be an array of numbers",
        got: system.images.allowed_sizes,
      });
    } else {
      for (const size of system.images.allowed_sizes) {
        if (typeof size !== "number" || size < 1) {
          errors.push({
            path: "system.images.allowed_sizes",
            message: "each size must be a positive number",
            got: size,
          });
          break;
        }
      }
    }
  }

  // languages
  if (system.languages) {
    if (!Array.isArray(system.languages.supported) || system.languages.supported.length === 0) {
      errors.push({
        path: "system.languages.supported",
        message: "must be a non-empty array of language codes",
        got: system.languages.supported,
      });
    }

    if (typeof system.languages.default !== "string") {
      errors.push({
        path: "system.languages.default",
        message: "must be a string (language code)",
        got: system.languages.default,
      });
    } else if (
      Array.isArray(system.languages.supported) &&
      !system.languages.supported.includes(system.languages.default)
    ) {
      errors.push({
        path: "system.languages.default",
        message: "must be one of the supported languages",
        got: system.languages.default,
        suggestion: `Supported: ${JSON.stringify(system.languages.supported)}`,
      });
    }
  }

  if (typeof system.debug !== "boolean") {
    errors.push({
      path: "system.debug",
      message: "must be a boolean",
      got: system.debug,
    });
  }

  if (typeof system.timezone !== "string") {
    errors.push({
      path: "system.timezone",
      message: "must be a string (e.g., 'UTC', 'America/New_York')",
      got: system.timezone,
    });
  }
}

// --- Theme validation ---

function validateTheme(theme: ThemeConfig, errors: ValidationError[]): void {
  if (!theme) {
    errors.push({ path: "theme", message: "theme configuration is required" });
    return;
  }

  if (typeof theme.name !== "string" || !theme.name.trim()) {
    errors.push({
      path: "theme.name",
      message: "must be a non-empty string",
      got: theme.name,
    });
  }

  if (theme.parent !== undefined && typeof theme.parent !== "string") {
    errors.push({
      path: "theme.parent",
      message: "must be a string (parent theme name) or omitted",
      got: theme.parent,
    });
  }
}

// --- Plugins validation ---

function validatePlugins(
  plugins: Record<string, Record<string, unknown>>,
  errors: ValidationError[],
): void {
  if (plugins === undefined || plugins === null) return;

  if (typeof plugins !== "object" || Array.isArray(plugins)) {
    errors.push({
      path: "plugins",
      message: "must be an object (plugin name → plugin config)",
      got: plugins,
    });
  }
}

// --- Helpers ---

function validateRecord(
  path: string,
  value: unknown,
  valueType: string,
  errors: ValidationError[],
): void {
  if (value === undefined || value === null) return;

  if (typeof value !== "object" || Array.isArray(value)) {
    errors.push({
      path,
      message: `must be an object (key → ${valueType})`,
      got: value,
    });
    return;
  }

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v !== valueType) {
      errors.push({
        path: `${path}.${k}`,
        message: `value must be a ${valueType}`,
        got: v,
      });
    }
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function formatError(err: ValidationError): string {
  let msg = `${err.path}: ${err.message}`;
  if (err.got !== undefined) {
    msg += `\n    Got: ${JSON.stringify(err.got)} (${typeof err.got})`;
  }
  if (err.suggestion) {
    msg += `\n    ${err.suggestion}`;
  }
  return msg;
}
