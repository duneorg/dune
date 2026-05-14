/**
 * Feature flags — runtime toggles without code changes.
 *
 * Flags are declared in site.yaml under `flags:` and resolved once at startup.
 * Values can be static booleans or `"env:VAR_NAME"` strings that delegate to
 * an environment variable.
 *
 * @example site.yaml
 * ```yaml
 * flags:
 *   comments: true
 *   new_editor: false
 *   beta_search: env:ENABLE_BETA_SEARCH
 * ```
 *
 * @example Usage in a plugin or route handler
 * ```ts
 * import { flag } from "@dune/core";
 * if (flag("comments")) { showCommentSection(); }
 * ```
 *
 * @example Usage in a TSX template
 * ```tsx
 * import { flag } from "@dune/core";
 * export default function Post({ page }: TemplateProps) {
 *   return (
 *     <article>
 *       {flag("comments") && <CommentSection pageRoute={page.route} />}
 *     </article>
 *   );
 * }
 * ```
 */

/** Resolved flag store — populated at startup by `initFlags()`. */
const _flags = new Map<string, boolean>();

/**
 * Resolve a raw config value to a boolean.
 *
 * - `true` / `false` → returned as-is
 * - `"env:VAR_NAME"` → `true` when the env var is "1", "true", or "yes"
 * - Any other string → `true` when the string is non-empty (fallback)
 */
function resolveValue(raw: boolean | string): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw.startsWith("env:")) {
    const varName = raw.slice(4).trim();
    const val = Deno.env.get(varName)?.toLowerCase() ?? "";
    return val === "1" || val === "true" || val === "yes";
  }
  // Unknown string form — treat as truthy
  return raw.length > 0;
}

/**
 * Initialise the flag store from the site config `flags` map.
 * Called once during server startup. Safe to call multiple times
 * (subsequent calls overwrite the previous state).
 */
export function initFlags(flags: Record<string, boolean | string> = {}): void {
  _flags.clear();
  for (const [name, raw] of Object.entries(flags)) {
    _flags.set(name, resolveValue(raw));
  }
}

/**
 * Check whether a named feature flag is enabled.
 *
 * Returns `false` for any flag not declared in `site.yaml` — unknown flags
 * are off by default so new features can be introduced safely.
 */
export function flag(name: string): boolean {
  return _flags.get(name) ?? false;
}

/**
 * Return a snapshot of all resolved flag values.
 * Useful for exposing flags to the admin panel or debug endpoints.
 */
export function allFlags(): Record<string, boolean> {
  return Object.fromEntries(_flags);
}
