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
 *
 * Pass 5 handles <source>/<audio>/<video> src attributes for colocated media.
 * Pass 6 handles <iframe src="./file.html"> co-located embeds. When the src
 * resolves to a co-located media file, the src is rewritten to an absolute URL
 * and a small inline listener script is emitted immediately after the closing
 * </iframe> tag. The corresponding sender script is injected by the engine into
 * the served HTML file itself (see engine.ts serveMedia). Together they
 * implement automatic height synchronisation with no author configuration.
 * This requires trusted_html to be set — the sanitiser strips <iframe> tags
 * otherwise, so the rewrite only takes effect when the author has opted in.
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

  // Pass 3: HTML <img src="..."> tags embedded in markdown
  result = result.replace(
    /(<img\b[^>]*?\bsrc=")([^"]+)(")/gi,
    (_match, before: string, src: string, after: string) => {
      if (isNonRelative(src)) return `${before}${src}${after}`;

      const bare = src.startsWith("./") ? src.slice(2) : src;
      const [filename, query] = bare.split("?", 2);
      const mediaFile = ctx.media.get(filename);
      if (mediaFile) {
        const url = query ? `${mediaFile.url}?${query}` : mediaFile.url;
        return `${before}${url}${after}`;
      }

      return `${before}${src}${after}`;
    },
  );

  // Pass 4: HTML <a href="..."> tags embedded in markdown
  result = result.replace(
    /(<a\b[^>]*?\bhref=")([^"]+)(")/gi,
    (_match, before: string, href: string, after: string) => {
      if (isNonRelative(href)) return `${before}${href}${after}`;

      const bare = href.startsWith("./") ? href.slice(2) : href;
      const [filename, query] = bare.split("?", 2);
      const mediaFile = ctx.media.get(filename);
      if (mediaFile) {
        const url = query ? `${mediaFile.url}?${query}` : mediaFile.url;
        return `${before}${url}${after}`;
      }

      return `${before}${href}${after}`;
    },
  );

  // Pass 5: <source src="...">, <audio src="...">, <video src="..."> elements.
  //
  // Handles both the common pattern (nested <source> inside <audio>/<video>) and
  // the direct src attribute on <audio>/<video> itself. <source> is a void element
  // so no closing tag matching is needed — just the opening tag's src attribute.
  result = result.replace(
    /(<(?:source|audio|video)\b[^>]*?\bsrc=")([^"]+)(")/gi,
    (_match, before: string, src: string, after: string) => {
      if (isNonRelative(src)) return `${before}${src}${after}`;

      const bare = src.startsWith("./") ? src.slice(2) : src;
      const [filename, query] = bare.split("?", 2);
      const mediaFile = ctx.media.get(filename);
      if (mediaFile) {
        const url = query ? `${mediaFile.url}?${query}` : mediaFile.url;
        return `${before}${url}${after}`;
      }

      return `${before}${src}${after}`;
    },
  );

  // Pass 6: <iframe src="./file.html"> co-located embeds.
  //
  // Matches a complete <iframe ...></iframe> unit whose src attribute is a
  // relative reference. When the src resolves to a co-located media file the
  // tag is rewritten with an absolute src and a namespaced auto-resize listener
  // script is appended immediately after the closing tag.
  //
  // Uses e.source === iframe.contentWindow to scope messages to this specific
  // iframe, so multiple iframes on the same page work independently.
  //
  // Uses [\s\S]*? (lazy dotall) to reliably handle multiline opening tags
  // where attributes span multiple lines.
  result = result.replace(
    /<iframe\b([\s\S]*?)\bsrc="([^"]+)"([\s\S]*?)>\s*<\/iframe>/gi,
    (_match, before: string, src: string, after: string) => {
      if (isNonRelative(src)) return _match;

      const bare = src.startsWith("./") ? src.slice(2) : src;
      const [filename] = bare.split("?", 1);
      const mediaFile = ctx.media.get(filename);
      if (!mediaFile) return _match;

      const rewritten = `<iframe${before}src="${mediaFile.url}"${after}></iframe>`;
      const listener =
        `<script>(function(){` +
        `var f=document.currentScript.previousElementSibling;` +
        `window.addEventListener('message',function(e){` +
        `if(e.data&&typeof e.data.__duneIframeHeight==='number'&&e.source===f.contentWindow)` +
        `f.style.height=e.data.__duneIframeHeight+'px';` +
        `});` +
        `})()</script>`;
      return `${rewritten}\n${listener}`;
    },
  );

  return result;
}

/**
 * Inline script injected by serveMedia() into co-located HTML files.
 *
 * Reports document height to the parent frame on load and on every resize,
 * enabling the listener emitted by resolveMediaRefs() Pass 5 to keep the
 * <iframe> height synchronised with its content without any author config.
 *
 * Exported so engine.ts can import a single canonical copy rather than
 * duplicating the string.
 */
export const IFRAME_SENDER_SCRIPT =
  `<script>(function(){` +
  `function r(){window.parent.postMessage(` +
  `{__duneIframeHeight:document.documentElement.scrollHeight},'*'` +
  `);}` +
  `window.addEventListener('load',r);` +
  `window.addEventListener('resize',r);` +
  `})()</script>`;
