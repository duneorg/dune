import type { MediaFile } from "../content/types.ts";

/**
 * Rewrite internal links in HTML to include language prefix when needed.
 * E.g. /contact → /de/contact when rendering a German page.
 */
export function rewriteInternalLinks(
  html: string,
  lang: string,
  defaultLang: string,
  includeDefaultInUrl: boolean,
  supportedLangs: string[],
): string {
  const needsPrefix = lang !== defaultLang || includeDefaultInUrl;
  if (!needsPrefix) return html;

  const langPrefix = `/${lang}`;
  const skipPrefixes = ["/themes/", "/content-media/", "/api/", "/admin/", "//", "mailto:", "tel:"];
  const hasLangPrefix = new RegExp(`^/(${supportedLangs.join("|")})(/|$)`);

  return html.replace(
    /href="(\/[^"]*)"/g,
    (_, path: string) => {
      if (hasLangPrefix.test(path)) return `href="${path}"`;
      if (skipPrefixes.some((p) => path.startsWith(p))) return `href="${path}"`;
      if (path.includes(":")) return `href="${path}"`;
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
