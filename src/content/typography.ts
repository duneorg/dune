/**
 * Typography utilities — orphan protection, etc.
 *
 * Orphan protection: inserts a non-breaking space (&nbsp;) before the last
 * word of each paragraph to prevent single words from wrapping to a new line.
 */

/**
 * Replace the last space before the last word with &nbsp; in:
 * - <p> elements
 * - <div> elements
 * - Lines ending with <br /> (e.g. in divs like hero-intro)
 */
export function applyOrphanProtection(html: string): string {
  let result = html;

  // Paragraphs: <p>...</p>
  result = result.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (match, attrs, content) => {
    const lastSpaceIndex = content.lastIndexOf(" ");
    if (lastSpaceIndex === -1) return match;
    const newContent =
      content.slice(0, lastSpaceIndex) + "\u00A0" + content.slice(lastSpaceIndex + 1);
    return `<p${attrs}>${newContent}</p>`;
  });

  // Divs: <div>...</div> (processes innermost first due to non-greedy match)
  result = result.replace(/<div([^>]*)>([\s\S]*?)<\/div>/gi, (match, attrs, content) => {
    const trimmed = content.trimEnd();
    const lastSpaceIndex = trimmed.lastIndexOf(" ");
    if (lastSpaceIndex === -1) return match;
    const newContent =
      trimmed.slice(0, lastSpaceIndex) + "\u00A0" + trimmed.slice(lastSpaceIndex + 1) +
      content.slice(trimmed.length);
    return `<div${attrs}>${newContent}</div>`;
  });

  // Lines ending with <br /> (e.g. <div class="hero-intro__text">line1<br />line2<br /></div>)
  result = result.replace(/([^<]+)(<br\s*\/?>)/gi, (match, text, br) => {
    const trimmed = text.trimEnd();
    const lastSpaceIndex = trimmed.lastIndexOf(" ");
    if (lastSpaceIndex === -1) return match;
    const newText =
      trimmed.slice(0, lastSpaceIndex) + "\u00A0" + trimmed.slice(lastSpaceIndex + 1);
    return newText + text.slice(trimmed.length) + br;
  });

  return result;
}
