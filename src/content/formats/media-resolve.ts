/**
 * Shared media reference resolver for markdown and MDX format handlers.
 *
 * Rewrites relative image and link references in raw markdown text to
 * absolute route-based URLs (e.g. `/einstieg/my-page/doc.pdf`) using the
 * co-located media index from the render context.
 *
 * Media files are served at their route-based path via a stat-first handler
 * in site-handler.ts: any URL ending in a known media extension is checked
 * against the content directory before falling through to the page router.
 * The legacy `/content-media/` prefix is kept only for backward compat.
 *
 * Rewriting at render time is necessary because Dune page URLs have no
 * trailing slash (e.g. `/einstieg/my-page`), so the browser cannot resolve a
 * bare relative href like `myfile.pdf` correctly — it strips the last segment
 * and resolves against `/einstieg/` instead of `/einstieg/my-page/`.
 */

import type { RenderContext } from "../types.ts";

/**
 * Returns true when an href requires no rewriting: it already carries enough
 * context for the browser to resolve it unambiguously.
 *
 * Covers:
 *   - Absolute URLs            http:// / https://
 *   - Protocol-relative        //cdn.example.com/…
 *   - Root-relative site paths /some/page  (already absolute on this origin)
 *   - URI schemes              mailto: / tel: / data: / blob: / …
 *   - In-page anchors          #section
 */
function isNonRelative(href: string): boolean {
  return (
    href.startsWith("http://") ||
    href.startsWith("https://") ||
    href.startsWith("//") ||
    href.startsWith("/") ||
    href.startsWith("#") ||
    /^[a-z][a-z0-9+\-.]*:/i.test(href) // any URI scheme (mailto:, tel:, data:, …)
  );
}

/**
 * Rewrite relative image and link references in raw markdown/MDX text to
 * absolute `/content-media/…` URLs.
 *
 * Pass 1 — images:  `![alt](filename.ext)`
 * Pass 2 — links:   `[text](filename.ext)`  (negative lookbehind skips images)
 *
 * In both cases:
 *   - Non-relative hrefs are left untouched.
 *   - A leading `./` is stripped before the filename lookup so that both
 *     `myfile.pdf` and `./myfile.pdf` resolve identically.
 *   - Query strings (e.g. `?width=800`) are preserved on the rewritten URL.
 *   - If the filename is not found in the co-located media index the
 *     reference is left unchanged.
 */
export function resolveMediaRefs(text: string, ctx: RenderContext): string {
  // Pass 1: images — ![alt](src)
  let result = text.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, alt: string, src: string) => {
      if (isNonRelative(src)) return `![${alt}](${src})`;

      const bare = src.startsWith("./") ? src.slice(2) : src;
      const [filename, query] = bare.split("?", 2);
      const mediaFile = ctx.media.get(filename);
      if (mediaFile) {
        const url = query ? `${mediaFile.url}?${query}` : mediaFile.url;
        return `![${alt}](${url})`;
      }

      return `![${alt}](${src})`;
    },
  );

  // Pass 2: links — [text](href), excluding images via negative lookbehind
  result = result.replace(
    /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g,
    (_match, text: string, href: string) => {
      if (isNonRelative(href)) return `[${text}](${href})`;

      // Strip explicit ./ so `./file.pdf` and `file.pdf` behave identically
      const bare = href.startsWith("./") ? href.slice(2) : href;
      const [filename, query] = bare.split("?", 2);
      const mediaFile = ctx.media.get(filename);
      if (mediaFile) {
        const url = query ? `${mediaFile.url}?${query}` : mediaFile.url;
        return `[${text}](${url})`;
      }

      return `[${text}](${href})`;
    },
  );

  return result;
}
