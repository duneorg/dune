/**
 * SSRF (Server-Side Request Forgery) defenses for outbound HTTP fetches.
 *
 * Validate a URL before fetch() to prevent admin-configured webhooks from
 * targeting internal infrastructure: cloud metadata endpoints, container
 * orchestrators, internal databases, loopback services, etc.
 *
 * Approach: parse the URL, refuse non-http(s) schemes, and refuse hostnames
 * that resolve to loopback / link-local / private / unique-local ranges.
 * For literal-IP hostnames, we can check immediately. For DNS hostnames, we
 * resolve via Deno.resolveDns() and check every returned address. The caller
 * must opt in to "allow private destinations" if they really want to deliver
 * to a same-network endpoint (e.g. an internal CI bot).
 */

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  // [network base as 32-bit int, mask bits]
  [octets(10, 0, 0, 0), 8],          // RFC1918
  [octets(172, 16, 0, 0), 12],       // RFC1918
  [octets(192, 168, 0, 0), 16],      // RFC1918
  [octets(127, 0, 0, 0), 8],         // loopback
  [octets(169, 254, 0, 0), 16],      // link-local
  [octets(0, 0, 0, 0), 8],           // "this network"
  [octets(100, 64, 0, 0), 10],       // CGN
];

function octets(a: number, b: number, c: number, d: number): number {
  // Use unsigned right shift to keep this in JS number range.
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets(nums[0], nums[1], nums[2], nums[3]);
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return PRIVATE_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (base & mask);
  });
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local fc00::/7
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped — extract embedded v4
    const v4 = lower.slice(7);
    return isPrivateIPv4(v4);
  }
  return false;
}

const HOSTNAME_DENYLIST = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

export interface SsrfCheckOptions {
  /** Caller opts in to allowing private/loopback destinations (e.g. for CI). */
  allowPrivateDestinations?: boolean;
}

export class SsrfBlockedError extends Error {
  override name = "SsrfBlockedError";
}

/**
 * Validate a URL string against SSRF policy. Throws SsrfBlockedError on
 * any disallowed target. Resolves DNS for hostnames via Deno.resolveDns()
 * and checks every returned address. Returns the resolved IP that should
 * be used for the actual fetch (so DNS rebinding can't slip in between
 * check and connect).
 */
export async function assertOutboundUrlAllowed(
  rawUrl: string,
  opts: SsrfCheckOptions = {},
): Promise<{ url: URL; resolvedAddress: string | null }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfBlockedError(`Refusing non-http(s) scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    throw new SsrfBlockedError("URL has no hostname");
  }

  // Strip optional [..] for IPv6 literals
  const stripped = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;

  if (!opts.allowPrivateDestinations && HOSTNAME_DENYLIST.has(stripped)) {
    throw new SsrfBlockedError(`Refusing denylisted hostname: ${stripped}`);
  }

  // If hostname is a literal IP, check directly.
  const literalV4 = ipv4ToInt(stripped);
  if (literalV4 !== null) {
    if (!opts.allowPrivateDestinations && isPrivateIPv4(stripped)) {
      throw new SsrfBlockedError(`Refusing private IPv4 target: ${stripped}`);
    }
    return { url: parsed, resolvedAddress: stripped };
  }
  // IPv6 literal heuristic: contains a ":" (and isn't a port-only spec).
  if (stripped.includes(":")) {
    if (!opts.allowPrivateDestinations && isPrivateIPv6(stripped)) {
      throw new SsrfBlockedError(`Refusing private IPv6 target: ${stripped}`);
    }
    return { url: parsed, resolvedAddress: stripped };
  }

  // DNS hostname — resolve and check every result.
  let addresses: string[] = [];
  try {
    const a = await Deno.resolveDns(stripped, "A").catch(() => [] as string[]);
    const aaaa = await Deno.resolveDns(stripped, "AAAA").catch(() => [] as string[]);
    addresses = [...a, ...aaaa];
  } catch (err) {
    throw new SsrfBlockedError(`DNS resolution failed for ${stripped}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError(`No A/AAAA records for ${stripped}`);
  }

  if (!opts.allowPrivateDestinations) {
    for (const addr of addresses) {
      if (addr.includes(":") ? isPrivateIPv6(addr) : isPrivateIPv4(addr)) {
        throw new SsrfBlockedError(`Refusing private DNS target ${stripped} -> ${addr}`);
      }
    }
  }

  return { url: parsed, resolvedAddress: addresses[0] };
}
