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
  [octets(192, 0, 0, 0), 24],        // IETF protocol assignments (incl. NAT64 traversal)
  [octets(192, 0, 2, 0), 24],        // TEST-NET-1 (documentation)
  [octets(198, 18, 0, 0), 15],       // benchmarking (RFC2544)
  [octets(198, 51, 100, 0), 24],     // TEST-NET-2 (documentation)
  [octets(203, 0, 113, 0), 24],      // TEST-NET-3 (documentation)
  [octets(240, 0, 0, 0), 4],         // reserved (class E) + broadcast 255.255.255.255
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
  if (lower.startsWith("64:ff9b:")) return true; // NAT64 well-known prefix 64:ff9b::/96
  if (lower.startsWith("100:")) return true; // discard-only range 100::/64
  if (lower.startsWith("2001:db8:")) return true; // documentation 2001:db8::/32
  if (
    lower.startsWith("::ffff:") || // IPv4-mapped
    lower.startsWith("::") // IPv4-compatible / mapped in hex form (::7f00:1)
  ) {
    const tail = lower.startsWith("::ffff:") ? lower.slice(7) : lower.slice(2);
    const v4 = ipv6TailToIPv4(tail);
    return v4 !== null ? isPrivateIPv4(v4) : false;
  }
  return false;
}

/** Convert the embedded-IPv4 tail of an ::/96 or ::ffff:0:0/96 address to dotted form. */
function ipv6TailToIPv4(tail: string): string | null {
  // Dotted form, e.g. "10.0.0.1"
  if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return tail;
  // Hex groups, e.g. "7f00:1" — last two groups hold the low 32 bits
  const groups = tail.split(":");
  if (groups.length < 2) return null;
  const hi = parseInt(groups[groups.length - 2], 16);
  const lo = parseInt(groups[groups.length - 1], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
  return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
}

const HOSTNAME_DENYLIST = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "metadata",
]);

/** Options for the SSRF destination check. */
export interface SsrfCheckOptions {
  /** Caller opts in to allowing private/loopback destinations (e.g. for CI). */
  allowPrivateDestinations?: boolean;
}

/** Thrown when a URL is blocked as an SSRF risk (private/loopback destination or denylisted hostname). */
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

/**
 * SSRF-safe `fetch`: validates the URL against the policy, pins the connection
 * to the address that was actually checked, and forces manual redirect
 * handling so a 30x to an internal host cannot bypass the guard.
 *
 * Pinning closes the DNS-rebinding TOCTOU window — `assertOutboundUrlAllowed`
 * resolves and vets every A/AAAA record, and we then connect to that exact IP
 * rather than re-resolving (which could now point at a private address).
 *
 * For `http:` the host is rewritten to the resolved IP with the original host
 * preserved in the `Host` header. For `https:` we dial the vetted IP via
 * `Deno.createHttpClient({ proxy: { transport: "tcp", ... } })` so SNI and
 * certificate validation still use the original hostname.
 *
 * Callers should treat any non-2xx (including 3xx, since redirects are manual)
 * as a failure.
 */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SsrfCheckOptions = {},
): Promise<Response> {
  const { url, resolvedAddress } = await assertOutboundUrlAllowed(rawUrl, opts);
  const requestInit: RequestInit = { ...init, redirect: "manual" };

  const hostIsName = resolvedAddress !== null &&
    url.hostname.toLowerCase() !== resolvedAddress.toLowerCase();

  // Pin the resolved IP for plaintext HTTP by rewriting the host and carrying
  // the original Host header. HTTPS cannot rewrite the host (SNI / cert), so
  // we dial the vetted IP via Deno.createHttpClient's tcp transport while
  // fetch() still uses the original hostname for SNI and certificate checks.
  if (hostIsName && url.protocol === "http:") {
    const headers = new Headers(requestInit.headers ?? init.headers ?? undefined);
    if (!headers.has("host")) headers.set("Host", url.host);
    const pinned = new URL(url.toString());
    pinned.hostname = resolvedAddress!;
    requestInit.headers = headers;
    return fetch(pinned, requestInit);
  }

  if (hostIsName && url.protocol === "https:") {
    const port = url.port ? Number(url.port) : 443;
    const client = Deno.createHttpClient({
      proxy: {
        transport: "tcp",
        hostname: resolvedAddress!,
        port,
      },
    });
    try {
      return await fetch(url, { ...requestInit, client } as RequestInit);
    } finally {
      client.close();
    }
  }

  return fetch(url, requestInit);
}
