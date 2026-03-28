/**
 * HTTP cache policy — per-route Cache-Control resolution.
 *
 * The site config can define rules keyed by URL prefix or exact path.
 * The longest matching prefix wins; falls back to the global default.
 */

/** A single per-route cache rule as it appears in site.yaml. */
export interface HttpCacheRule {
  /**
   * URL prefix or exact path (e.g. "/blog", "/", "/api/").
   * Exact match takes priority; otherwise longest-prefix wins.
   */
  pattern: string;
  /**
   * Browser / CDN max-age in seconds.
   * 0 = browsers must revalidate; CDNs may still cache with SWR.
   */
  max_age?: number;
  /** Stale-while-revalidate in seconds (CDN/shared-cache only). */
  stale_while_revalidate?: number;
  /**
   * When true, emit `Cache-Control: no-store`.
   * Disables all caching (useful for dynamic/personalized routes).
   */
  no_store?: boolean;
}

/** Resolved cache directives for a single request. */
export interface ResolvedCachePolicy {
  maxAge: number;
  swr: number;
  noStore: boolean;
}

/** Defaults used when no rule matches. */
export interface CachePolicyDefaults {
  maxAge: number;
  swr: number;
}

/**
 * Build a Cache-Control header value from resolved directives.
 *
 * @example
 * buildCacheControl({ maxAge: 0, swr: 60, noStore: false })
 * // → "public, max-age=0, stale-while-revalidate=60"
 */
export function buildCacheControl(policy: ResolvedCachePolicy): string {
  if (policy.noStore) return "no-store";
  const parts: string[] = ["public", `max-age=${policy.maxAge}`];
  if (policy.swr > 0) parts.push(`stale-while-revalidate=${policy.swr}`);
  return parts.join(", ");
}

/**
 * Resolve the effective cache policy for a URL pathname.
 *
 * Resolution order:
 *   1. Exact match in rules
 *   2. Longest-prefix match in rules
 *   3. Defaults
 */
export function resolvePolicy(
  pathname: string,
  rules: HttpCacheRule[],
  defaults: CachePolicyDefaults,
): ResolvedCachePolicy {
  // Exact match first
  const exact = rules.find((r) => r.pattern === pathname);
  if (exact) return applyRule(exact, defaults);

  // Longest prefix
  let best: HttpCacheRule | undefined;
  for (const rule of rules) {
    if (pathname.startsWith(rule.pattern)) {
      if (!best || rule.pattern.length > best.pattern.length) {
        best = rule;
      }
    }
  }
  if (best) return applyRule(best, defaults);

  return { maxAge: defaults.maxAge, swr: defaults.swr, noStore: false };
}

function applyRule(rule: HttpCacheRule, defaults: CachePolicyDefaults): ResolvedCachePolicy {
  return {
    maxAge: rule.max_age ?? defaults.maxAge,
    swr: rule.stale_while_revalidate ?? defaults.swr,
    noStore: rule.no_store ?? false,
  };
}
