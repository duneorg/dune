/**
 * Built-in section definitions for the Visual Page Builder.
 * Ten section types covering the most common landing page patterns.
 */

import type { SectionDef } from "./types.ts";

export const BUILT_IN_SECTIONS: SectionDef[] = [
  // ── Hero ─────────────────────────────────────────────────────────────────
  {
    type: "hero",
    label: "Hero",
    icon: "🚀",
    description: "Full-width headline with CTA buttons",
    fields: [
      { id: "headline", type: "text", label: "Headline", required: true, default: "Welcome to Our Site" },
      { id: "subtext", type: "textarea", label: "Subtext", default: "A short description of what you offer." },
      { id: "cta_text", type: "text", label: "Primary CTA Label", default: "Get Started" },
      { id: "cta_url", type: "url", label: "Primary CTA URL", default: "/" },
      { id: "cta2_text", type: "text", label: "Secondary CTA Label", placeholder: "Learn More" },
      { id: "cta2_url", type: "url", label: "Secondary CTA URL", placeholder: "/about" },
      {
        id: "background",
        type: "select",
        label: "Background",
        default: "light",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "brand", label: "Brand color" },
        ],
      },
      { id: "image", type: "image", label: "Background image URL", placeholder: "/media/hero.jpg" },
    ],
  },

  // ── Features ─────────────────────────────────────────────────────────────
  {
    type: "features",
    label: "Features",
    icon: "✨",
    description: "Grid of feature cards with icons",
    fields: [
      { id: "title", type: "text", label: "Section Title", default: "Why Choose Us" },
      { id: "subtitle", type: "textarea", label: "Subtitle" },
      {
        id: "columns",
        type: "select",
        label: "Columns",
        default: "3",
        options: [
          { value: "2", label: "2 columns" },
          { value: "3", label: "3 columns" },
          { value: "4", label: "4 columns" },
        ],
      },
      {
        id: "items",
        type: "list",
        label: "Features",
        itemFields: [
          { id: "icon", type: "text", label: "Icon (emoji)", default: "⚡" },
          { id: "title", type: "text", label: "Title", required: true, default: "Feature" },
          { id: "description", type: "textarea", label: "Description", default: "A short description." },
        ],
      },
    ],
  },

  // ── Testimonials ─────────────────────────────────────────────────────────
  {
    type: "testimonials",
    label: "Testimonials",
    icon: "💬",
    description: "Customer quotes and social proof",
    fields: [
      { id: "title", type: "text", label: "Section Title", default: "What Our Customers Say" },
      {
        id: "items",
        type: "list",
        label: "Testimonials",
        itemFields: [
          { id: "quote", type: "textarea", label: "Quote", required: true, default: "This is an amazing product!" },
          { id: "author", type: "text", label: "Author Name", required: true, default: "Jane Smith" },
          { id: "role", type: "text", label: "Role", default: "CEO" },
          { id: "company", type: "text", label: "Company", default: "Acme Corp" },
          { id: "avatar", type: "image", label: "Avatar URL" },
        ],
      },
    ],
  },

  // ── CTA ──────────────────────────────────────────────────────────────────
  {
    type: "cta",
    label: "Call to Action",
    icon: "📣",
    description: "Prominent call-to-action band",
    fields: [
      { id: "headline", type: "text", label: "Headline", required: true, default: "Ready to get started?" },
      { id: "subtext", type: "textarea", label: "Subtext", default: "Join thousands of happy customers today." },
      { id: "cta_text", type: "text", label: "Button Label", required: true, default: "Start Now" },
      { id: "cta_url", type: "url", label: "Button URL", required: true, default: "/contact" },
      {
        id: "background",
        type: "select",
        label: "Background",
        default: "brand",
        options: [
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
          { value: "brand", label: "Brand color" },
        ],
      },
    ],
  },

  // ── Gallery ───────────────────────────────────────────────────────────────
  {
    type: "gallery",
    label: "Gallery",
    icon: "🖼️",
    description: "Image gallery with optional captions",
    fields: [
      { id: "title", type: "text", label: "Section Title" },
      {
        id: "columns",
        type: "select",
        label: "Columns",
        default: "3",
        options: [
          { value: "2", label: "2 columns" },
          { value: "3", label: "3 columns" },
          { value: "4", label: "4 columns" },
        ],
      },
      {
        id: "items",
        type: "list",
        label: "Images",
        itemFields: [
          { id: "image", type: "image", label: "Image URL", required: true, default: "/media/photo.jpg" },
          { id: "caption", type: "text", label: "Caption" },
          { id: "alt", type: "text", label: "Alt text" },
        ],
      },
    ],
  },

  // ── Pricing ───────────────────────────────────────────────────────────────
  {
    type: "pricing",
    label: "Pricing",
    icon: "💰",
    description: "Pricing plans comparison table",
    fields: [
      { id: "title", type: "text", label: "Section Title", default: "Simple Pricing" },
      { id: "subtitle", type: "textarea", label: "Subtitle", default: "No hidden fees. Cancel anytime." },
      {
        id: "items",
        type: "list",
        label: "Plans",
        itemFields: [
          { id: "name", type: "text", label: "Plan Name", required: true, default: "Starter" },
          { id: "price", type: "text", label: "Price", required: true, default: "$9" },
          { id: "period", type: "text", label: "Period", default: "per month" },
          { id: "features", type: "textarea", label: "Features (one per line)", default: "5 projects\n10 GB storage\nEmail support" },
          { id: "cta_text", type: "text", label: "Button Label", default: "Get Started" },
          { id: "cta_url", type: "url", label: "Button URL", default: "/signup" },
          { id: "highlighted", type: "toggle", label: "Highlight this plan", default: false },
        ],
      },
    ],
  },

  // ── FAQ ───────────────────────────────────────────────────────────────────
  {
    type: "faq",
    label: "FAQ",
    icon: "❓",
    description: "Frequently asked questions accordion",
    fields: [
      { id: "title", type: "text", label: "Section Title", default: "Frequently Asked Questions" },
      {
        id: "items",
        type: "list",
        label: "Questions",
        itemFields: [
          { id: "question", type: "text", label: "Question", required: true, default: "How does it work?" },
          { id: "answer", type: "textarea", label: "Answer", required: true, default: "It works by..." },
        ],
      },
    ],
  },

  // ── Text ─────────────────────────────────────────────────────────────────
  {
    type: "text",
    label: "Rich Text",
    icon: "📝",
    description: "Free-form HTML content block",
    fields: [
      { id: "content", type: "richtext", label: "Content", required: true, default: "<p>Write your content here.</p>" },
      {
        id: "width",
        type: "select",
        label: "Width",
        default: "normal",
        options: [
          { value: "narrow", label: "Narrow (640px)" },
          { value: "normal", label: "Normal (800px)" },
          { value: "wide", label: "Wide (full)" },
        ],
      },
    ],
  },

  // ── Columns ───────────────────────────────────────────────────────────────
  {
    type: "columns",
    label: "Columns",
    icon: "⬛",
    description: "Two or three column content layout",
    fields: [
      {
        id: "count",
        type: "select",
        label: "Column count",
        default: "2",
        options: [
          { value: "2", label: "2 columns" },
          { value: "3", label: "3 columns" },
        ],
      },
      { id: "col1", type: "richtext", label: "Column 1", default: "<p>Column 1 content.</p>" },
      { id: "col2", type: "richtext", label: "Column 2", default: "<p>Column 2 content.</p>" },
      { id: "col3", type: "richtext", label: "Column 3 (if 3-col)", placeholder: "<p>Column 3 content.</p>" },
    ],
  },

  // ── Contact ───────────────────────────────────────────────────────────────
  {
    type: "contact",
    label: "Contact Info",
    icon: "📬",
    description: "Contact details and optional form link",
    fields: [
      { id: "title", type: "text", label: "Section Title", default: "Get in Touch" },
      { id: "subtext", type: "textarea", label: "Intro text", default: "We'd love to hear from you." },
      { id: "email", type: "text", label: "Email address" },
      { id: "phone", type: "text", label: "Phone number" },
      { id: "address", type: "textarea", label: "Address" },
      { id: "cta_text", type: "text", label: "Button Label", placeholder: "Send a Message" },
      { id: "cta_url", type: "url", label: "Button URL", placeholder: "/contact" },
    ],
  },
];
