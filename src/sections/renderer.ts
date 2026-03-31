/**
 * Server-side HTML renderer for page-builder sections.
 * Produces self-contained HTML with embedded styles — no theme dependency.
 * Theme templates can optionally override individual section types by providing
 * a template named "pb-{type}" (e.g. "pb-hero").
 */

import type { SectionInstance } from "./types.ts";

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bgClass(bg: unknown): string {
  if (bg === "dark") return "pb-bg-dark";
  if (bg === "brand") return "pb-bg-brand";
  return "pb-bg-light";
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const SECTIONS_CSS = `
.pb-sections { box-sizing: border-box; }
.pb-sections *, .pb-sections *::before, .pb-sections *::after { box-sizing: inherit; }
.pb-section { width: 100%; padding: 4rem 1.5rem; }
.pb-container { max-width: 1100px; margin: 0 auto; }
.pb-section-title { font-size: 2rem; font-weight: 700; margin: 0 0 .5rem; line-height: 1.2; }
.pb-section-subtitle { font-size: 1.125rem; color: #555; margin: 0 0 2.5rem; max-width: 640px; }
.pb-bg-light { background: #fff; color: #1a1a1a; }
.pb-bg-dark  { background: #111827; color: #f9fafb; }
.pb-bg-dark .pb-section-subtitle { color: #9ca3af; }
.pb-bg-brand { background: #2563eb; color: #fff; }
.pb-bg-brand .pb-section-subtitle { color: #bfdbfe; }
/* Hero */
.pb-hero { text-align: center; padding: 5rem 1.5rem; }
.pb-hero-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 0; opacity: .35; }
.pb-hero-inner { position: relative; z-index: 1; max-width: 760px; margin: 0 auto; }
.pb-hero-wrap { position: relative; overflow: hidden; }
.pb-hero-headline { font-size: 3rem; font-weight: 800; margin: 0 0 1.25rem; line-height: 1.1; }
.pb-hero-sub { font-size: 1.25rem; margin: 0 0 2.5rem; opacity: .85; }
.pb-hero-ctas { display: flex; gap: .75rem; justify-content: center; flex-wrap: wrap; }
.pb-btn { display: inline-block; padding: .7rem 1.6rem; border-radius: .375rem; font-weight: 600; text-decoration: none; font-size: 1rem; transition: opacity .15s; }
.pb-btn:hover { opacity: .85; }
.pb-btn-primary { background: #2563eb; color: #fff; }
.pb-btn-primary-inv { background: #fff; color: #2563eb; }
.pb-btn-secondary { background: transparent; color: currentColor; border: 2px solid currentColor; }
/* Features */
.pb-grid { display: grid; gap: 1.75rem; }
.pb-grid-2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.pb-grid-3 { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.pb-grid-4 { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.pb-feature-card { padding: 1.5rem; border-radius: .5rem; background: #f9fafb; }
.pb-bg-dark .pb-feature-card { background: #1f2937; }
.pb-feature-icon { font-size: 2rem; margin-bottom: .75rem; }
.pb-feature-title { font-size: 1.125rem; font-weight: 700; margin: 0 0 .5rem; }
.pb-feature-desc { color: #6b7280; font-size: .95rem; margin: 0; line-height: 1.5; }
.pb-bg-dark .pb-feature-desc { color: #9ca3af; }
/* Testimonials */
.pb-testimonial-card { padding: 1.75rem; border-radius: .5rem; background: #f9fafb; border-left: 4px solid #2563eb; }
.pb-bg-dark .pb-testimonial-card { background: #1f2937; }
.pb-testimonial-quote { font-size: 1.05rem; line-height: 1.6; margin: 0 0 1.25rem; font-style: italic; }
.pb-testimonial-meta { display: flex; align-items: center; gap: .75rem; }
.pb-testimonial-avatar { width: 2.5rem; height: 2.5rem; border-radius: 50%; object-fit: cover; }
.pb-testimonial-name { font-weight: 700; font-size: .95rem; margin: 0; }
.pb-testimonial-role { font-size: .85rem; color: #6b7280; margin: 0; }
.pb-bg-dark .pb-testimonial-role { color: #9ca3af; }
/* CTA */
.pb-cta { text-align: center; }
.pb-cta-headline { font-size: 2.25rem; font-weight: 800; margin: 0 0 1rem; }
.pb-cta-sub { font-size: 1.125rem; margin: 0 0 2rem; opacity: .85; }
/* Gallery */
.pb-gallery-img-wrap { overflow: hidden; border-radius: .375rem; background: #e5e7eb; }
.pb-gallery-img { width: 100%; height: 220px; object-fit: cover; display: block; }
.pb-gallery-caption { font-size: .85rem; color: #6b7280; margin: .4rem 0 0; }
/* Pricing */
.pb-pricing-card { padding: 2rem; border-radius: .5rem; border: 2px solid #e5e7eb; text-align: center; position: relative; }
.pb-pricing-card.pb-highlighted { border-color: #2563eb; box-shadow: 0 8px 32px rgba(37,99,235,.15); }
.pb-pricing-badge { position: absolute; top: -1px; right: -1px; background: #2563eb; color: #fff; font-size: .75rem; font-weight: 700; padding: .25rem .75rem; border-radius: 0 .5rem 0 .5rem; }
.pb-pricing-name { font-size: 1.125rem; font-weight: 700; margin: 0 0 1rem; }
.pb-pricing-price { font-size: 3rem; font-weight: 800; margin: 0; line-height: 1; }
.pb-pricing-period { font-size: .9rem; color: #6b7280; margin: .25rem 0 1.5rem; }
.pb-pricing-features { list-style: none; padding: 0; margin: 0 0 2rem; text-align: left; }
.pb-pricing-features li { padding: .4rem 0; border-bottom: 1px solid #e5e7eb; font-size: .95rem; }
.pb-pricing-features li::before { content: "✓ "; color: #2563eb; font-weight: 700; }
/* FAQ */
.pb-faq-item { border-bottom: 1px solid #e5e7eb; }
.pb-faq-question { font-weight: 600; font-size: 1.05rem; padding: 1.1rem 0; margin: 0; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
.pb-faq-question::after { content: "+"; font-size: 1.4rem; color: #6b7280; flex-shrink: 0; }
.pb-faq-answer { font-size: .975rem; line-height: 1.6; color: #555; padding: 0 0 1.25rem; margin: 0; display: none; }
.pb-faq-item.pb-open .pb-faq-answer { display: block; }
.pb-faq-item.pb-open .pb-faq-question::after { content: "−"; }
/* Text */
.pb-text-narrow { max-width: 640px; margin: 0 auto; }
.pb-text-normal { max-width: 800px; margin: 0 auto; }
.pb-richtext { line-height: 1.7; font-size: 1.05rem; }
.pb-richtext h2, .pb-richtext h3 { margin-top: 1.5rem; }
.pb-richtext a { color: #2563eb; }
/* Columns */
.pb-columns { display: grid; gap: 2rem; }
.pb-columns-2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.pb-columns-3 { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.pb-col { line-height: 1.7; font-size: 1rem; }
/* Contact */
.pb-contact-grid { display: grid; gap: 2.5rem; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.pb-contact-detail { display: flex; align-items: flex-start; gap: .75rem; margin-bottom: 1rem; }
.pb-contact-icon { font-size: 1.25rem; flex-shrink: 0; margin-top: .1rem; }
.pb-contact-text { font-size: .975rem; color: #555; white-space: pre-line; }
/* Shared section header */
.pb-section-header { margin-bottom: 2.5rem; }
`.trim();

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHero(s: SectionInstance): string {
  const bg = bgClass(s.background);
  const hasImage = s.image && String(s.image).trim();
  const wrapClass = hasImage ? "pb-hero-wrap" : "";
  const sectionClass = `pb-section pb-hero ${bg} ${wrapClass}`.trim();

  const imgTag = hasImage
    ? `<img class="pb-hero-img" src="${esc(s.image)}" alt="">`
    : "";

  const primary = s.cta_text
    ? `<a href="${esc(s.cta_url || "#")}" class="pb-btn ${bg === "pb-bg-light" ? "pb-btn-primary" : "pb-btn-primary-inv"}">${esc(s.cta_text)}</a>`
    : "";
  const secondary = s.cta2_text
    ? `<a href="${esc(s.cta2_url || "#")}" class="pb-btn pb-btn-secondary">${esc(s.cta2_text)}</a>`
    : "";
  const ctas = primary || secondary
    ? `<div class="pb-hero-ctas">${primary}${secondary}</div>`
    : "";

  return `
<section class="${sectionClass}">
  ${imgTag}
  <div class="pb-hero-inner">
    <h1 class="pb-hero-headline">${esc(s.headline)}</h1>
    ${s.subtext ? `<p class="pb-hero-sub">${esc(s.subtext)}</p>` : ""}
    ${ctas}
  </div>
</section>`;
}

function renderFeatures(s: SectionInstance): string {
  const cols = String(s.columns ?? "3");
  const items = Array.isArray(s.items) ? s.items as Record<string, unknown>[] : [];
  const cards = items.map((item) => `
    <div class="pb-feature-card">
      ${item.icon ? `<div class="pb-feature-icon">${esc(item.icon)}</div>` : ""}
      <h3 class="pb-feature-title">${esc(item.title)}</h3>
      ${item.description ? `<p class="pb-feature-desc">${esc(item.description)}</p>` : ""}
    </div>`).join("");

  return `
<section class="pb-section pb-bg-light">
  <div class="pb-container">
    ${renderSectionHeader(s)}
    <div class="pb-grid pb-grid-${cols}">${cards}</div>
  </div>
</section>`;
}

function renderTestimonials(s: SectionInstance): string {
  const items = Array.isArray(s.items) ? s.items as Record<string, unknown>[] : [];
  const cards = items.map((item) => {
    const avatar = item.avatar
      ? `<img class="pb-testimonial-avatar" src="${esc(item.avatar)}" alt="${esc(item.author)}">`
      : `<div class="pb-testimonial-avatar" style="background:#e5e7eb;display:flex;align-items:center;justify-content:center;font-size:1.1rem">👤</div>`;
    return `
    <div class="pb-testimonial-card">
      <p class="pb-testimonial-quote">${esc(item.quote)}</p>
      <div class="pb-testimonial-meta">
        ${avatar}
        <div>
          <p class="pb-testimonial-name">${esc(item.author)}</p>
          <p class="pb-testimonial-role">${[item.role, item.company].filter(Boolean).map(esc).join(", ")}</p>
        </div>
      </div>
    </div>`;
  }).join("");

  return `
<section class="pb-section pb-bg-light">
  <div class="pb-container">
    ${renderSectionHeader(s)}
    <div class="pb-grid pb-grid-3">${cards}</div>
  </div>
</section>`;
}

function renderCta(s: SectionInstance): string {
  const bg = bgClass(s.background);
  const btnClass = bg === "pb-bg-light" ? "pb-btn-primary" : "pb-btn-primary-inv";
  const btn = s.cta_text
    ? `<a href="${esc(s.cta_url || "#")}" class="pb-btn ${btnClass}">${esc(s.cta_text)}</a>`
    : "";

  return `
<section class="pb-section pb-cta ${bg}">
  <div class="pb-container">
    <h2 class="pb-cta-headline">${esc(s.headline)}</h2>
    ${s.subtext ? `<p class="pb-cta-sub">${esc(s.subtext)}</p>` : ""}
    ${btn}
  </div>
</section>`;
}

function renderGallery(s: SectionInstance): string {
  const cols = String(s.columns ?? "3");
  const items = Array.isArray(s.items) ? s.items as Record<string, unknown>[] : [];
  const imgs = items.map((item) => `
    <div>
      <div class="pb-gallery-img-wrap">
        <img class="pb-gallery-img" src="${esc(item.image)}" alt="${esc(item.alt || item.caption || "")}">
      </div>
      ${item.caption ? `<p class="pb-gallery-caption">${esc(item.caption)}</p>` : ""}
    </div>`).join("");

  return `
<section class="pb-section pb-bg-light">
  <div class="pb-container">
    ${renderSectionHeader(s)}
    <div class="pb-grid pb-grid-${cols}">${imgs}</div>
  </div>
</section>`;
}

function renderPricing(s: SectionInstance): string {
  const items = Array.isArray(s.items) ? s.items as Record<string, unknown>[] : [];
  const cols = Math.min(items.length || 1, 4);
  const cards = items.map((item) => {
    const hl = Boolean(item.highlighted);
    const features = String(item.features ?? "").split("\n").filter((f) => f.trim());
    const fItems = features.map((f) => `<li>${esc(f.trim())}</li>`).join("");
    const btn = item.cta_text
      ? `<a href="${esc(item.cta_url || "#")}" class="pb-btn pb-btn-primary" style="width:100%;text-align:center">${esc(item.cta_text)}</a>`
      : "";
    return `
    <div class="pb-pricing-card${hl ? " pb-highlighted" : ""}">
      ${hl ? `<span class="pb-pricing-badge">Popular</span>` : ""}
      <p class="pb-pricing-name">${esc(item.name)}</p>
      <p class="pb-pricing-price">${esc(item.price)}</p>
      <p class="pb-pricing-period">${esc(item.period)}</p>
      ${fItems ? `<ul class="pb-pricing-features">${fItems}</ul>` : ""}
      ${btn}
    </div>`;
  }).join("");

  return `
<section class="pb-section pb-bg-light">
  <div class="pb-container" style="text-align:center">
    ${renderSectionHeader(s)}
    <div class="pb-grid pb-grid-${cols <= 2 ? "2" : cols <= 3 ? "3" : "4"}">${cards}</div>
  </div>
</section>`;
}

function renderFaq(s: SectionInstance): string {
  const items = Array.isArray(s.items) ? s.items as Record<string, unknown>[] : [];
  const faqs = items.map((item, i) => `
    <div class="pb-faq-item" id="pb-faq-${i}">
      <h3 class="pb-faq-question" onclick="(function(el){el.closest('.pb-faq-item').classList.toggle('pb-open')})(this)">${esc(item.question)}</h3>
      <p class="pb-faq-answer">${esc(item.answer)}</p>
    </div>`).join("");

  return `
<section class="pb-section pb-bg-light">
  <div class="pb-container" style="max-width:760px">
    ${renderSectionHeader(s)}
    <div>${faqs}</div>
  </div>
</section>`;
}

function renderText(s: SectionInstance): string {
  const width = String(s.width ?? "normal");
  const wClass = width === "narrow" ? "pb-text-narrow" : width === "wide" ? "" : "pb-text-normal";
  return `
<section class="pb-section pb-bg-light">
  <div class="pb-container">
    <div class="${wClass} pb-richtext">${String(s.content ?? "")}</div>
  </div>
</section>`;
}

function renderColumns(s: SectionInstance): string {
  const count = String(s.count ?? "2");
  const cols = [s.col1, s.col2, count === "3" ? s.col3 : null].filter(Boolean);
  const colHtml = cols.map((c) => `<div class="pb-col pb-richtext">${String(c ?? "")}</div>`).join("");
  return `
<section class="pb-section pb-bg-light">
  <div class="pb-container">
    <div class="pb-columns pb-columns-${count}">${colHtml}</div>
  </div>
</section>`;
}

function renderContact(s: SectionInstance): string {
  const details: string[] = [];
  if (s.email) details.push(`<div class="pb-contact-detail"><span class="pb-contact-icon">✉️</span><span class="pb-contact-text">${esc(s.email)}</span></div>`);
  if (s.phone) details.push(`<div class="pb-contact-detail"><span class="pb-contact-icon">📞</span><span class="pb-contact-text">${esc(s.phone)}</span></div>`);
  if (s.address) details.push(`<div class="pb-contact-detail"><span class="pb-contact-icon">📍</span><span class="pb-contact-text">${esc(s.address)}</span></div>`);
  const btn = s.cta_text
    ? `<a href="${esc(s.cta_url || "#")}" class="pb-btn pb-btn-primary" style="margin-top:1.5rem">${esc(s.cta_text)}</a>`
    : "";

  return `
<section class="pb-section pb-bg-light">
  <div class="pb-container">
    ${renderSectionHeader(s)}
    <div>${details.join("")}${btn}</div>
  </div>
</section>`;
}

function renderSectionHeader(s: SectionInstance): string {
  if (!s.title && !s.subtitle) return "";
  return `<div class="pb-section-header">
    ${s.title ? `<h2 class="pb-section-title">${esc(s.title)}</h2>` : ""}
    ${s.subtitle ? `<p class="pb-section-subtitle">${esc(s.subtitle)}</p>` : ""}
  </div>`;
}

function renderSection(s: SectionInstance): string {
  switch (s.type) {
    case "hero":         return renderHero(s);
    case "features":     return renderFeatures(s);
    case "testimonials": return renderTestimonials(s);
    case "cta":          return renderCta(s);
    case "gallery":      return renderGallery(s);
    case "pricing":      return renderPricing(s);
    case "faq":          return renderFaq(s);
    case "text":         return renderText(s);
    case "columns":      return renderColumns(s);
    case "contact":      return renderContact(s);
    default:             return `<!-- unknown section type: ${esc(s.type)} -->`;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Render an array of SectionInstance objects to an HTML string.
 * The result can be used as the page body (dangerouslySetInnerHTML) or
 * injected directly into a full HTML document.
 */
export function renderSections(sections: SectionInstance[]): string {
  if (!sections.length) return "";
  const html = sections.map(renderSection).join("\n");
  return `<style>${SECTIONS_CSS}</style>\n<div class="pb-sections">${html}\n</div>`;
}
