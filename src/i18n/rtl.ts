/**
 * RTL (right-to-left) language detection utilities.
 *
 * Used by the theme renderer and admin panel to add correct `dir` attributes
 * to HTML pages when the active language uses a right-to-left script.
 */

/** ISO 639-1 language codes whose primary script is right-to-left. */
const RTL_LANGUAGES = new Set([
  "ar", // Arabic
  "he", // Hebrew
  "fa", // Persian / Farsi
  "ur", // Urdu
  "ps", // Pashto
  "yi", // Yiddish
  "ug", // Uyghur
  "ku", // Kurdish (Sorani)
  "sd", // Sindhi
  "dv", // Divehi / Maldivian
  "ks", // Kashmiri
  "pa", // Punjabi (Shahmukhi script; Gurmukhi is LTR)
]);

/**
 * Return true when the given BCP-47 language tag uses a right-to-left script.
 *
 * Handles both bare codes ("ar") and region-tagged codes ("ar-SA").
 * An optional `extra` set lets callers extend the built-in list at runtime
 * (e.g. from `system.languages.rtl_override` in site.yaml).
 */
export function isRtl(lang: string, extra?: string[]): boolean {
  const base = lang.split("-")[0].toLowerCase();
  return RTL_LANGUAGES.has(base) || (extra?.includes(base) ?? false);
}

/**
 * Return "rtl" or "ltr" for the given language code.
 *
 * @param lang  BCP-47 language tag, e.g. "ar", "ar-SA", "en", "de"
 * @param extra Optional additional RTL language codes (from site config)
 */
export function directionOf(lang: string, extra?: string[]): "rtl" | "ltr" {
  return isRtl(lang, extra) ? "rtl" : "ltr";
}
