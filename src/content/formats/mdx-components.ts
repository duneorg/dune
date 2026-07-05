/**
 * MDX component registry — provides components available within MDX content.
 *
 * MDX files can use JSX components inline. This registry manages which
 * components are available and loads theme-provided components.
 */

/**
 * Sanitizer allowances a theme's mdx-components module may declare (named
 * export `sanitize`) so the markup its components emit survives the MDX
 * output sanitizer without the site opting into `trusted_html`. The
 * extension only widens the tag/attribute allowlist — script execution,
 * event handlers and unsafe URL schemes stay blocked.
 *
 *   export const sanitize = {
 *     tags: ["aside", "svg", "path", "my-widget"],
 *     attributes: { "*": ["role", "aria-*"], svg: ["viewBox", "fill"] },
 *   };
 */
export interface MdxSanitizeExtension {
  /** Tags to allow in addition to the sanitizer defaults. */
  tags?: readonly string[];
  /** Attributes to allow, keyed by tag (`*` = all tags, `aria-*` wildcards supported). */
  attributes?: Record<string, readonly string[]>;
}

/** Registry of components available within MDX content, keyed by name. */
export interface MdxComponentRegistry {
  /** Register a component by name for use in MDX content */
  register(name: string, component: unknown): void;
  /** Get all registered components as a scope object */
  getComponents(): Record<string, unknown>;
  /** Check if a component is registered */
  has(name: string): boolean;
}

/**
 * Create a new MDX component registry with optional default components.
 */
export function createMdxComponentRegistry(
  defaults?: Record<string, unknown>,
): MdxComponentRegistry {
  const components = new Map<string, unknown>();

  // Register defaults if provided
  if (defaults) {
    for (const [name, component] of Object.entries(defaults)) {
      components.set(name, component);
    }
  }

  return {
    register(name: string, component: unknown): void {
      components.set(name, component);
    },

    getComponents(): Record<string, unknown> {
      return Object.fromEntries(components);
    },

    has(name: string): boolean {
      return components.has(name);
    },
  };
}
