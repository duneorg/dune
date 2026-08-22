/**
 * Same-origin CSRF checks for cookie-authenticated mutations.
 *
 * Browsers send Origin on form POST. Missing Origin used to fail open, which
 * lets a cross-site request that omits Origin (older browsers, some
 * non-browser clients that still carry cookies) through. We still fail open
 * when Origin, Sec-Fetch-Site, and Referer are all absent — that path is
 * curl / webhooks, and SameSite=Lax is the remaining backstop.
 */

export function csrfForbidden(): Response {
  return Response.json(
    { error: "Forbidden: cross-origin request rejected" },
    { status: 403 },
  );
}

function hostMatches(rawUrl: string, expectedHost: string): boolean {
  try {
    return new URL(rawUrl).host === expectedHost;
  } catch {
    return false;
  }
}

/**
 * Same-origin CSRF guard for mutating methods.
 * Returns a 403 response when the request looks cross-site, otherwise null.
 */
export function checkSameOriginCsrf(
  req: Request,
  url: URL = new URL(req.url),
): Response | null {
  const method = req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return null;
  }

  const origin = req.headers.get("origin");
  if (origin !== null) {
    return hostMatches(origin, url.host) ? null : csrfForbidden();
  }

  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite !== null) {
    if (secFetchSite === "same-origin" || secFetchSite === "none") return null;
    return csrfForbidden();
  }

  const referer = req.headers.get("referer");
  if (referer !== null) {
    return hostMatches(referer, url.host) ? null : csrfForbidden();
  }

  return null;
}
