import type { MediaFile } from "../content/types.ts";

/**
 * Strip a leading supported-language segment from a URL pathname:
 * `/de/blog/doc.pdf` → `/blog/doc.pdf`. Returns the input unchanged when the
 * first segment is not a supported language or nothing would remain after it.
 */
export function stripLangPrefix(
  pathname: string,
  supportedLangs: string[],
): string {
  const m = pathname.match(/^\/([^/]+)(\/.+)$/);
  return m && supportedLangs.includes(m[1]) ? m[2] : pathname;
}

/**
 * Rewrite internal links in HTML to include language prefix when needed.
 * E.g. /contact → /de/contact when rendering a German page. Links to the
 * page's own `colocatedMedia` are left alone.
 */
export function rewriteInternalLinks(
  html: string,
  lang: string,
  defaultLang: string,
  includeDefaultInUrl: boolean,
  supportedLangs: string[],
  colocatedMedia: MediaFile[] = [],
): string {
  const needsPrefix = lang !== defaultLang || includeDefaultInUrl;
  if (!needsPrefix) return html;

  const langPrefix = `/${lang}`;
  const skipPrefixes = ["/themes/", "/content-media/", "/api/", "/admin/", "//", "mailto:", "tel:"];
  const mediaUrls = new Set(colocatedMedia.map((m) => m.url));
  const hasLangPrefix = new RegExp(`^/(${supportedLangs.join("|")})(/|$)`);

  return html.replace(
    /href="(\/[^"]*)"/g,
    (_, path: string) => {
      if (hasLangPrefix.test(path)) return `href="${path}"`;
      if (skipPrefixes.some((p) => path.startsWith(p))) return `href="${path}"`;
      if (path.includes(":")) return `href="${path}"`;
      // The page's own co-located files are served at their unprefixed path.
      // Matched by URL, not extension: /old-page.html is a page, not a file.
      if (mediaUrls.has(path.split(/[?#]/)[0])) return `href="${path}"`;
      const newPath = path === "/" ? langPrefix : `${langPrefix}${path}`;
      return `href="${newPath}"`;
    },
  );
}

/** Build a MediaHelper from a page's media files. */
export function createMediaHelper(media: MediaFile[]) {
  return {
    url: (filename: string) => {
      const file = media.find((m) => m.name === filename);
      return file?.url ?? "";
    },
    get: (filename: string) => media.find((m) => m.name === filename) ?? null,
    list: () => media,
  };
}
