/**
 * Template `output` modes — templates that produce the response body
 * themselves instead of an HTML document.
 *
 * A template module declares one with a named export:
 *
 * ```ts
 * export const output = "fragment"; // HTML, no document shell
 * export const output = "json";     // application/json
 * export const output = "xml";      // application/xml
 * export const output = "text";     // text/plain
 * export const output = "text/csv"; // any other media type, verbatim
 * ```
 *
 * Omitted, a template renders into the normal HTML document.
 *
 * The declaration lives in template code on purpose, never in page
 * frontmatter: a page author who could choose the media type could serve
 * attacker-controlled `text/javascript` or `text/html` from the site's origin.
 *
 * @module
 */

/** A resolved `output` declaration. */
export interface TemplateOutput {
  /**
   * `"fragment"`: the template returns JSX, rendered as HTML with no document
   * wrapper. `"data"`: the template returns a string (or, for JSON, a
   * serializable value) which is sent as-is.
   */
  kind: "fragment" | "data";
  /** Full `Content-Type` header value. */
  contentType: string;
  /** Serialize a non-string return value with `JSON.stringify`. */
  json: boolean;
}

const SHORTHANDS: Record<string, TemplateOutput> = {
  fragment: { kind: "fragment", contentType: "text/html; charset=utf-8", json: false },
  json: { kind: "data", contentType: "application/json; charset=utf-8", json: true },
  xml: { kind: "data", contentType: "application/xml; charset=utf-8", json: false },
  text: { kind: "data", contentType: "text/plain; charset=utf-8", json: false },
};

/** `type/subtype` only: no parameters or whitespace, so it can't smuggle header syntax. */
const MEDIA_TYPE_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i;

function wantsCharset(mediaType: string): boolean {
  const lower = mediaType.toLowerCase();
  return lower.startsWith("text/") ||
    /^application\/(json|xml|javascript)$/.test(lower) ||
    /\+(json|xml)$/.test(lower);
}

/**
 * Resolve a template's `output` export. Returns `null` when the value is not
 * a recognised shorthand or a plain `type/subtype` media type.
 */
export function parseTemplateOutput(value: unknown): TemplateOutput | null {
  if (typeof value !== "string") return null;
  const shorthand = SHORTHANDS[value];
  if (shorthand) return { ...shorthand };
  if (!MEDIA_TYPE_RE.test(value)) return null;

  const lower = value.toLowerCase();
  // An explicit text/html is the same thing as "fragment".
  if (lower === "text/html") return { ...SHORTHANDS.fragment };
  return {
    kind: "data",
    contentType: wantsCharset(value) ? `${value}; charset=utf-8` : value,
    json: lower === "application/json" || lower.endsWith("+json"),
  };
}

/**
 * Turn what a `"data"` template returned into a response body.
 *
 * A string is sent unchanged (for JSON it is assumed to be pre-serialized).
 * For JSON, any other defined value is `JSON.stringify`'d. Anything else is a
 * template bug and throws, so it surfaces as a 500 instead of `[object Object]`.
 */
export function dataOutputBody(result: unknown, output: TemplateOutput, templateName: string): string {
  if (typeof result === "string") return result;
  if (output.json && result !== undefined) {
    const json = JSON.stringify(result);
    if (json !== undefined) return json;
  }
  throw new Error(
    `Template "${templateName}" declares output "${output.contentType.split(";")[0]}" and must return a string` +
      `${output.json ? " or a JSON-serializable value" : ""}, got ${result === null ? "null" : typeof result}`,
  );
}

/**
 * Extra response headers for a bare output of this media type.
 *
 * `image/svg+xml` gets the same sandbox uploaded SVG media gets (see
 * `registerContentCatchAll`): script inside an SVG that is opened directly runs
 * in an opaque origin, so it can't read the site's cookies or call same-origin
 * endpoints, which matters if a template interpolates page content into SVG
 * without escaping it. SVG used as an `<img>` is unaffected. HTML fragments are
 * deliberately left alone (they must stay embeddable, and Preact escapes them),
 * and `text/javascript` can't be sandboxed, so that stays a documented
 * responsibility of the theme author.
 */
export function outputSecurityHeaders(contentType: string): Record<string, string> {
  if (contentType.split(";")[0].trim().toLowerCase() === "image/svg+xml") {
    return {
      "Content-Security-Policy": "sandbox allow-scripts allow-popups",
      "X-Frame-Options": "SAMEORIGIN",
    };
  }
  return {};
}
