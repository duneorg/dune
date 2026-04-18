/**
 * HTML sanitizer with a tag/attribute allowlist.
 *
 * Designed for user-authored content that should render as formatted HTML
 * (markdown body, page-builder richtext, imported posts) without enabling
 * script execution, event handlers, or navigation to unsafe URL schemes.
 *
 * This is a streaming tokenizer, not a DOM parser — it never interprets
 * malformed markup, it just drops anything it doesn't recognize. That means
 * nested/broken tags cannot smuggle disallowed content through.
 *
 * What gets stripped:
 *   - Script-ish tags entirely (<script>, <style>, <iframe>, <object>,
 *     <embed>, <form>, <link>, <meta>, <base>, <template>, <noscript>) —
 *     including their contents when they have raw-text content models.
 *   - Any tag not in the allowlist (tag dropped, text content preserved).
 *   - Any attribute not allowlisted for its tag.
 *   - `on*` event handler attributes (always).
 *   - `style` attributes (can carry `expression()` / URL values in old
 *     browsers, and serve no purpose in user content).
 *   - `href`/`src`/`action`/`formaction` with unsafe URL schemes
 *     (see src/security/urls.ts).
 *   - HTML comments.
 *
 * Not a replacement for CSP — it's a defense-in-depth layer.
 */

import { isSafeUrl } from "./urls.ts";

export interface SanitizeOptions {
  /** Allow these tags in addition to the defaults. */
  extraTags?: readonly string[];
  /** Disallow these tags even if they're in the defaults. */
  disallowTags?: readonly string[];
  /** Allow <img> tags. Default: true. */
  allowImages?: boolean;
  /** Allow <a> with href. Default: true. */
  allowLinks?: boolean;
}

/** Default allowlist — formatting + structural tags found in user content. */
const DEFAULT_TAGS: ReadonlySet<string> = new Set([
  "p", "br", "hr",
  "strong", "b", "em", "i", "u", "s", "del", "ins", "mark", "sub", "sup", "small",
  "a",
  "ul", "ol", "li",
  "dl", "dt", "dd",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "blockquote", "q", "cite",
  "code", "pre", "kbd", "samp", "var",
  "img", "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
  "span", "div",
  "details", "summary",
  "abbr", "time",
]);

/**
 * Attribute allowlist per tag.
 * `*` applies to all allowed tags.
 * URL attributes are validated against the safe-scheme list.
 */
const TAG_ATTRS: Record<string, readonly string[]> = {
  "*": ["class", "id", "title", "lang", "dir"],
  a: ["href", "rel", "target", "name"],
  img: ["src", "alt", "width", "height", "loading"],
  time: ["datetime"],
  abbr: ["title"],
  th: ["scope", "colspan", "rowspan"],
  td: ["colspan", "rowspan"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start", "type", "reversed"],
  li: ["value"],
  details: ["open"],
};

/** Raw-text elements: everything inside is text, not parseable HTML.
 *  We drop these entirely including their contents. */
const RAW_TEXT_TAGS: ReadonlySet<string> = new Set([
  "script", "style", "iframe", "noscript", "noembed", "xmp", "plaintext",
]);

/**
 * Escape literal `<`, `>`, and bare `&` in text — preserve existing entity
 * references so markdown like `&amp;` or `&#x27;` round-trips correctly.
 */
function escText(s: string): string {
  return s
    .replace(/&(?!#?[a-zA-Z0-9]+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** URL-carrying attributes: validated with isSafeUrl. */
const URL_ATTRS: ReadonlySet<string> = new Set(["href", "src", "action", "formaction"]);

/**
 * Sanitize an HTML fragment.
 *
 * Runs in O(n) over the input; makes no DOM allocations.
 */
export function sanitizeHtml(input: string, opts: SanitizeOptions = {}): string {
  if (!input) return "";

  const allowed = new Set(DEFAULT_TAGS);
  if (opts.extraTags) for (const t of opts.extraTags) allowed.add(t.toLowerCase());
  if (opts.disallowTags) for (const t of opts.disallowTags) allowed.delete(t.toLowerCase());
  if (opts.allowImages === false) allowed.delete("img");
  if (opts.allowLinks === false) allowed.delete("a");

  const out: string[] = [];
  const stack: string[] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    const ch = input[i];

    if (ch !== "<") {
      // Text content — find next < or end.
      const next = input.indexOf("<", i);
      const end = next === -1 ? len : next;
      out.push(escText(input.slice(i, end)));
      i = end;
      continue;
    }

    // At "<". Classify: comment, cdata, doctype, closing tag, or open tag.
    if (input.startsWith("<!--", i)) {
      // Drop comments entirely.
      const end = input.indexOf("-->", i + 4);
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", i)) {
      const end = input.indexOf("]]>", i + 9);
      const text = end === -1 ? input.slice(i + 9) : input.slice(i + 9, end);
      out.push(escText(text));
      i = end === -1 ? len : end + 3;
      continue;
    }
    if (input[i + 1] === "!" || input[i + 1] === "?") {
      // DOCTYPE or processing instruction — drop.
      const end = input.indexOf(">", i);
      i = end === -1 ? len : end + 1;
      continue;
    }

    // Closing tag: </tag ...>
    if (input[i + 1] === "/") {
      const end = input.indexOf(">", i);
      if (end === -1) {
        // Malformed — drop rest.
        break;
      }
      const tagPart = input.slice(i + 2, end).trim().split(/\s/)[0].toLowerCase();
      i = end + 1;
      if (!tagPart || !/^[a-z][a-z0-9-]*$/.test(tagPart)) continue;
      if (!allowed.has(tagPart)) continue;
      // Pop to matching open tag if present (handles ill-nested input).
      const idx = stack.lastIndexOf(tagPart);
      if (idx === -1) continue;
      // Emit closing tags for all stack entries above (and including) idx.
      while (stack.length > idx) {
        const t = stack.pop()!;
        out.push(`</${t}>`);
      }
      continue;
    }

    // Opening tag: <tag ...> or <tag .../>
    const tagMatch = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(input.slice(i));
    if (!tagMatch) {
      // Not a tag — treat as literal text.
      out.push("&lt;");
      i += 1;
      continue;
    }
    const rawTag = tagMatch[1];
    const tag = rawTag.toLowerCase();
    const tagStart = i + 1 + rawTag.length;

    // Find end of open tag, respecting quoted attribute values.
    let j = tagStart;
    let inQuote: string | null = null;
    while (j < len) {
      const c = input[j];
      if (inQuote) {
        if (c === inQuote) inQuote = null;
      } else {
        if (c === '"' || c === "'") inQuote = c;
        else if (c === ">") break;
      }
      j += 1;
    }
    if (j >= len) {
      // Unterminated tag — drop rest.
      break;
    }
    const inner = input.slice(tagStart, j);
    const selfClosing = inner.endsWith("/");
    const attrPart = selfClosing ? inner.slice(0, -1) : inner;
    i = j + 1;

    // Raw-text tags: skip open tag AND content until matching close.
    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = input.slice(i);
      const m = closeRe.exec(rest);
      i = m ? i + m.index + m[0].length : len;
      continue;
    }

    if (!allowed.has(tag)) {
      // Drop the tag but keep nested text/allowed tags via the stream.
      continue;
    }

    const attrs = parseAttrs(attrPart, tag);

    // Void tags per HTML spec — don't push onto stack.
    const isVoid = VOID_TAGS.has(tag) || selfClosing;

    out.push(renderOpenTag(tag, attrs, isVoid));
    if (!isVoid) stack.push(tag);
  }

  // Close any remaining open tags.
  while (stack.length > 0) {
    const t = stack.pop()!;
    out.push(`</${t}>`);
  }
  return out.join("");
}

const VOID_TAGS: ReadonlySet<string> = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

interface ParsedAttr {
  name: string;
  value: string;
}

/** Parse an attribute string like `class="foo" href='bar' disabled`. */
function parseAttrs(src: string, tag: string): ParsedAttr[] {
  const out: ParsedAttr[] = [];
  const globalAllowed = TAG_ATTRS["*"] ?? [];
  const tagAllowed = TAG_ATTRS[tag] ?? [];
  const allowedSet = new Set([...globalAllowed, ...tagAllowed]);

  // Regex-based tokenizer — keep it simple.
  const re = /([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";

    // Always strip event handlers and style.
    if (name.startsWith("on")) continue;
    if (name === "style") continue;
    if (name === "is" || name === "xmlns" || name.startsWith("xmlns:")) continue;

    if (!allowedSet.has(name)) continue;

    // URL attributes: scheme-validate.
    if (URL_ATTRS.has(name)) {
      if (!isSafeUrl(value)) continue;
    }

    // `target` attribute: if present and external, we still allow — but strip
    // javascript: equivalents by restricting to known values.
    if (name === "target") {
      if (!["_blank", "_self", "_parent", "_top"].includes(value)) continue;
    }

    // `rel` attribute: drop anything not alphabetic+space (defense against
    // browser-quirk parsing).
    if (name === "rel") {
      if (!/^[a-zA-Z\s-]*$/.test(value)) continue;
    }

    out.push({ name, value });
  }

  // If <a target="_blank"> is present without a safe rel, inject one to
  // prevent reverse-tabnabbing.
  if (tag === "a") {
    const hasTargetBlank = out.some((a) => a.name === "target" && a.value === "_blank");
    const relIdx = out.findIndex((a) => a.name === "rel");
    if (hasTargetBlank) {
      const safeRel = "noopener noreferrer";
      if (relIdx === -1) out.push({ name: "rel", value: safeRel });
      else if (!/noopener/i.test(out[relIdx].value)) {
        out[relIdx] = { name: "rel", value: `${out[relIdx].value} ${safeRel}`.trim() };
      }
    }
  }

  return out;
}

function renderOpenTag(tag: string, attrs: ParsedAttr[], isVoid: boolean): string {
  const parts = [tag];
  for (const a of attrs) {
    if (a.value === "") parts.push(a.name);
    else parts.push(`${a.name}="${escAttr(a.value)}"`);
  }
  const inner = parts.join(" ");
  return isVoid ? `<${inner}>` : `<${inner}>`;
}
