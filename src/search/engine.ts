/**
 * Search engine — full-text search over the content index.
 *
 * Builds a lightweight inverted index from page titles, frontmatter,
 * and content bodies. Supports incremental updates and relevance scoring.
 *
 * For v0.1: in-memory index built at startup. No persistence.
 * Future: store index in .dune/search-index.json or KV.
 */

import type { PageIndex } from "../content/types.ts";
import type { StorageAdapter } from "../storage/types.ts";
import type { FormatRegistry } from "../content/formats/registry.ts";

export interface SearchEngineOptions {
  /** All page indexes */
  pages: PageIndex[];
  /** Storage adapter for reading content files */
  storage: StorageAdapter;
  /** Content directory (relative to storage root) */
  contentDir: string;
  /** Format handlers for extracting body text */
  formats: FormatRegistry;
  /**
   * Additional frontmatter field names to include in the full-text index.
   * By default only title, template, taxonomy values, and body text are indexed.
   * Specify extra field names here to make custom frontmatter fields searchable.
   * @example ["summary", "author", "tags"]
   */
  customFields?: string[];
  /**
   * Per-field relevance weight multipliers (field name → multiplier).
   * Keys: "title", "body", "summary", or any customField name.
   * Default weight for any unspecified field: 1.
   */
  fieldWeights?: Record<string, number>;
  /** Return highlighted excerpts. Default: true */
  highlightMatches?: boolean;
  /** Character length of returned excerpts. Default: 160 */
  excerptLength?: number;
  /**
   * Pre-loaded Flex Object records to index alongside content pages.
   * Each entry produces a synthetic PageIndex at route /flex/{type}/{id}.
   */
  flexRecords?: Array<{
    type: string;
    id: string;
    fields: Record<string, unknown>;
  }>;
}

export interface SearchResult {
  /** The matched page */
  page: PageIndex;
  /** Relevance score (higher = better) */
  score: number;
  /** Matching excerpt/context around the hit */
  excerpt: string;
  /** Query terms that matched (for <mark> highlighting) */
  highlights?: string[];
  /** Facet field values extracted from this result's frontmatter */
  facetValues?: Record<string, string | string[]>;
}

export interface SearchEngine {
  /** Build the search index (call after content index is ready) */
  build(): Promise<void>;
  /** Search for pages matching a query */
  search(query: string, limit?: number): SearchResult[];
  /** Rebuild index (after content changes) */
  rebuild(pages: PageIndex[]): Promise<void>;
  /**
   * Return autocomplete suggestions for a given prefix string.
   *
   * Scans indexed terms and page titles for entries that begin with
   * the normalised prefix. Returns up to `limit` unique strings,
   * short-circuiting as soon as the limit is reached.
   *
   * @param prefix - The text the user has typed so far
   * @param limit  - Maximum number of suggestions (default: 10)
   */
  suggest(prefix: string, limit?: number): string[];
}

/** Internal document representation for the index */
interface IndexedDocument {
  sourcePath: string;
  /** Concatenated searchable text (lowercased) */
  text: string;
  /** Title text (lowercased, for weighted scoring) */
  titleText: string;
  /** Summary/description text (lowercased, for weighted scoring) */
  summaryText: string;
  /** Body text (lowercased, for weighted scoring) */
  bodyText: string;
  /** Per-custom-field text (lowercased) keyed by field name */
  customFieldTexts: Record<string, string>;
  /** Original (non-lowercased) text for excerpt generation */
  rawText: string;
  /** The PageIndex entry */
  page: PageIndex;
  /** Raw frontmatter for facet extraction */
  frontmatter: Record<string, unknown>;
}

/**
 * Create a search engine.
 */
export function createSearchEngine(
  options: SearchEngineOptions,
): SearchEngine {
  let { pages, storage, contentDir, formats } = options;
  const fieldWeights = options.fieldWeights ?? {};
  const highlightMatches = options.highlightMatches ?? true;
  const excerptLength = options.excerptLength ?? 160;
  const flexRecords = options.flexRecords ?? [];

  // Inverted index: term → Set<sourcePath>
  const invertedIndex = new Map<string, Set<string>>();
  // Document store: sourcePath → IndexedDocument
  const documents = new Map<string, IndexedDocument>();

  /**
   * Tokenize text into searchable terms.
   */
  function tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2);
  }

  /**
   * Index a single document.
   */
  function indexDocument(doc: IndexedDocument): void {
    documents.set(doc.sourcePath, doc);

    const terms = tokenize(doc.text);
    const titleTerms = tokenize(doc.titleText);

    // Index body terms
    for (const term of terms) {
      if (!invertedIndex.has(term)) {
        invertedIndex.set(term, new Set());
      }
      invertedIndex.get(term)!.add(doc.sourcePath);
    }

    // Index title terms (they're already in the text, but this ensures coverage)
    for (const term of titleTerms) {
      if (!invertedIndex.has(term)) {
        invertedIndex.set(term, new Set());
      }
      invertedIndex.get(term)!.add(doc.sourcePath);
    }
  }

  /**
   * Strip markdown and HTML markup from a string for plain-text indexing.
   */
  function stripMarkup(body: string): string {
    return body
      .replace(/```[\s\S]*?```/g, "")  // Remove code blocks
      .replace(/`[^`]+`/g, "")          // Remove inline code
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")  // Remove images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")  // Links → text
      .replace(/<[^>]+>/g, "")          // Remove HTML tags
      .replace(/^#{1,6}\s+/gm, "")      // Remove headers syntax
      .replace(/\*\*([^*]+)\*\*/g, "$1") // Bold → text
      .replace(/\*([^*]+)\*/g, "$1")     // Italic → text
      .replace(/^[-*+]\s+/gm, "")       // List markers
      .replace(/^>\s+/gm, "")            // Blockquotes
      .replace(/---+/g, "")              // Horizontal rules
      .replace(/\n{2,}/g, "\n");
  }

  /**
   * Resolve a dot-path into an object, e.g. "taxonomy.category" → obj.taxonomy.category.
   */
  function dotGet(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let cur: unknown = obj;
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[p];
    }
    return cur;
  }

  /**
   * Extract searchable text from a page's content.
   * Returns structured per-field text for weighted scoring.
   */
  async function extractTextFields(page: PageIndex): Promise<{
    titleText: string;
    summaryText: string;
    bodyText: string;
    customFieldTexts: Record<string, string>;
    rawBodyText: string;
    frontmatter: Record<string, unknown>;
  }> {
    let bodyText = "";
    let rawBodyText = "";
    let summaryText = "";
    const customFieldTexts: Record<string, string> = {};
    let frontmatter: Record<string, unknown> = {};

    // Try to read the content file for body text and custom frontmatter fields.
    try {
      const filePath = `${contentDir}/${page.sourcePath}`;
      const raw = await storage.readText(filePath);
      const handler = formats.getForFile(page.sourcePath);

      if (handler) {
        const body = handler.extractBody(raw, filePath);
        if (body) {
          const plain = stripMarkup(body);
          rawBodyText = plain;
          bodyText = plain.toLowerCase();
        }

        // Extract custom frontmatter fields (same raw file, no extra I/O)
        const customFields = options.customFields;
        const fm = await handler.extractFrontmatter(raw, filePath);
        frontmatter = fm as Record<string, unknown>;

        // Extract summary/description text from frontmatter if present.
        // PageFrontmatter.summary is an object (config), not a string — check
        // the raw frontmatter cast for a user-supplied "description" field.
        const fmAny = fm as Record<string, unknown>;
        if (typeof fmAny["description"] === "string") {
          summaryText = (fmAny["description"] as string).toLowerCase();
        } else if (typeof fmAny["excerpt"] === "string") {
          summaryText = (fmAny["excerpt"] as string).toLowerCase();
        }

        if (customFields?.length) {
          for (const field of customFields) {
            const val = fm[field];
            const parts: string[] = [];
            if (typeof val === "string") {
              parts.push(val);
            } else if (Array.isArray(val)) {
              for (const item of val) {
                if (typeof item === "string") parts.push(item);
              }
            }
            if (parts.length > 0) {
              customFieldTexts[field] = parts.join(" ").toLowerCase();
            }
          }
        }
      }
    } catch {
      // Content file not readable — index only metadata
    }

    return {
      titleText: page.title.toLowerCase(),
      summaryText,
      bodyText,
      customFieldTexts,
      rawBodyText,
      frontmatter,
    };
  }

  /**
   * Build a synthetic PageIndex for a Flex Object record.
   */
  function flexRecordToPageIndex(
    type: string,
    id: string,
    fields: Record<string, unknown>,
  ): PageIndex {
    const title = typeof fields.title === "string"
      ? fields.title
      : typeof fields.name === "string"
      ? fields.name
      : `${type}/${id}`;

    return {
      sourcePath: `flex-objects/${type}/${id}.yaml`,
      route: `/flex/${type}/${id}`,
      language: "en",
      format: "md",
      template: type,
      title,
      navTitle: title,
      date: null,
      published: true,
      status: "published",
      visible: true,
      routable: true,
      isModule: false,
      order: 0,
      depth: 1,
      parentPath: null,
      taxonomy: {},
      mtime: 0,
      hash: "",
    };
  }

  /**
   * Score a search query against a document.
   *
   * @param termRegexps  Pre-compiled regexps parallel to queryTerms — one
   *   per term, compiled once per query in search() so they are not
   *   reconstructed for every candidate document.  String.match() with a
   *   /g regex resets lastIndex after each call, so the same RegExp objects
   *   are safe to reuse across multiple documents.
   */
  function scoreDocument(
    doc: IndexedDocument,
    queryTerms: string[],
    termRegexps: RegExp[],
  ): { score: number; excerpt: string; highlights: string[] } {
    let score = 0;
    const titleWeight = fieldWeights["title"] ?? 1;
    const bodyWeight = fieldWeights["body"] ?? 1;
    const summaryWeight = fieldWeights["summary"] ?? 1;
    const matchedTerms: string[] = [];

    for (let i = 0; i < queryTerms.length; i++) {
      const term = queryTerms[i];
      let termMatched = false;

      // Title match (boosted 3x × weight)
      if (doc.titleText.includes(term)) {
        score += 3 * titleWeight;
        termMatched = true;
        // Exact title match (boosted extra)
        if (doc.titleText === term) score += 5 * titleWeight;
      }

      // Summary match (2x × weight)
      if (doc.summaryText && doc.summaryText.includes(term)) {
        score += 2 * summaryWeight;
        termMatched = true;
      }

      // Body match — use pre-compiled regexp (no per-document construction)
      if (doc.bodyText) {
        const bodyMatches = (doc.bodyText.match(termRegexps[i]) || []).length;
        score += Math.min(bodyMatches, 5) * bodyWeight; // Cap at 5 per term
        if (bodyMatches > 0) termMatched = true;
      }

      // Custom field matches
      for (const [fieldName, fieldText] of Object.entries(doc.customFieldTexts)) {
        if (fieldText.includes(term)) {
          const w = fieldWeights[fieldName] ?? 1;
          score += 1 * w;
          termMatched = true;
        }
      }

      // Taxonomy match (boosted 2x)
      for (const values of Object.values(doc.page.taxonomy)) {
        for (const val of values) {
          if (val.toLowerCase().includes(term)) {
            score += 2;
            termMatched = true;
          }
        }
      }

      if (termMatched) matchedTerms.push(term);
    }

    // Multi-term bonus: if all terms match, boost score
    const allMatch = queryTerms.every(
      (term) =>
        doc.titleText.includes(term) ||
        doc.bodyText.includes(term) ||
        doc.summaryText.includes(term) ||
        Object.values(doc.customFieldTexts).some((t) => t.includes(term)),
    );
    if (allMatch && queryTerms.length > 1) score *= 1.5;

    // Extract best excerpt from raw body text
    const excerpt = extractBestExcerpt(doc, queryTerms, excerptLength);

    return { score, excerpt, highlights: matchedTerms };
  }

  /**
   * Find the highest-density window of `length` chars in the body that
   * contains the most query terms. Falls back to the page title area.
   */
  function extractBestExcerpt(
    doc: IndexedDocument,
    queryTerms: string[],
    length: number,
  ): string {
    const text = doc.rawText || doc.titleText;
    if (!text) return "";

    const textLower = text.toLowerCase();
    let bestStart = -1;
    let bestCount = -1;

    // Slide a window of `length` characters and count matching terms per window
    const step = Math.max(1, Math.floor(length / 4));
    for (let start = 0; start < textLower.length; start += step) {
      const windowLower = textLower.slice(start, start + length);
      let count = 0;
      for (const term of queryTerms) {
        if (windowLower.includes(term)) count++;
      }
      if (count > bestCount) {
        bestCount = count;
        bestStart = start;
      }
    }

    if (bestStart < 0 || bestCount === 0) {
      // No match in body; try to find in full combined text as fallback
      const combined = doc.text;
      for (const term of queryTerms) {
        const idx = combined.indexOf(term);
        if (idx >= 0) {
          const start = Math.max(0, idx - 60);
          const end = Math.min(combined.length, start + length);
          return (start > 0 ? "..." : "") +
            text.slice(start, end).trim() +
            (end < combined.length ? "..." : "");
        }
      }
      // Absolute fallback: first N chars of text
      return text.slice(0, length).trim() + (text.length > length ? "..." : "");
    }

    const start = bestStart;
    const end = Math.min(text.length, start + length);
    return (start > 0 ? "..." : "") +
      text.slice(start, end).trim() +
      (end < text.length ? "..." : "");
  }

  return {
    async build(): Promise<void> {
      invertedIndex.clear();
      documents.clear();

      for (const page of pages) {
        if (!page.published) continue;
        if (!page.routable) continue;

        const {
          titleText,
          summaryText,
          bodyText,
          customFieldTexts,
          rawBodyText,
          frontmatter,
        } = await extractTextFields(page);

        // Full combined text for inverted index
        const textParts = [
          titleText,
          page.template,
          summaryText,
          bodyText,
          ...Object.values(customFieldTexts),
        ];
        for (const values of Object.values(page.taxonomy)) {
          textParts.push(...values.map((v) => v.toLowerCase()));
        }
        const text = textParts.join(" ");

        indexDocument({
          sourcePath: page.sourcePath,
          text,
          titleText,
          summaryText,
          bodyText,
          customFieldTexts,
          rawText: rawBodyText,
          page,
          frontmatter,
        });
      }

      // Index flex records
      for (const rec of flexRecords) {
        const page = flexRecordToPageIndex(rec.type, rec.id, rec.fields);
        const textParts: string[] = [];
        const customFieldTexts: Record<string, string> = {};

        for (const [k, v] of Object.entries(rec.fields)) {
          if (k.startsWith("_")) continue;
          if (typeof v === "string") {
            textParts.push(v.toLowerCase());
            customFieldTexts[k] = v.toLowerCase();
          } else if (Array.isArray(v)) {
            const joined = v.filter((x) => typeof x === "string").join(" ");
            if (joined) {
              textParts.push(joined.toLowerCase());
              customFieldTexts[k] = joined.toLowerCase();
            }
          }
        }

        const titleText = page.title.toLowerCase();
        const text = [titleText, ...textParts].join(" ");

        indexDocument({
          sourcePath: page.sourcePath,
          text,
          titleText,
          summaryText: "",
          bodyText: textParts.join(" "),
          customFieldTexts,
          rawText: textParts.map((_, i) => Object.values(rec.fields).filter((v) => typeof v === "string")[i] ?? "").join(" "),
          page,
          frontmatter: rec.fields,
        });
      }
    },

    search(query: string, limit: number = 20): SearchResult[] {
      const queryTerms = tokenize(query);
      if (queryTerms.length === 0) return [];

      // Pre-compile one RegExp per term.  These are reused across all
      // candidate documents — avoids constructing N_terms × N_docs regexp
      // objects on every search call.
      const termRegexps = queryTerms.map(
        (t) => new RegExp(escapeRegex(t), "g"),
      );

      // Find candidate documents (any term matches)
      const candidates = new Set<string>();
      for (const term of queryTerms) {
        // Prefix matching for partial terms
        for (const [indexedTerm, docs] of invertedIndex.entries()) {
          if (indexedTerm.startsWith(term) || term.startsWith(indexedTerm)) {
            for (const sp of docs) candidates.add(sp);
          }
        }
      }

      // Score and rank
      const results: SearchResult[] = [];
      for (const sp of candidates) {
        const doc = documents.get(sp);
        if (!doc) continue;

        const { score, excerpt, highlights } = scoreDocument(doc, queryTerms, termRegexps);
        if (score > 0) {
          const result: SearchResult = { page: doc.page, score, excerpt };
          if (highlightMatches) {
            result.highlights = highlights;
          }
          results.push(result);
        }
      }

      // Sort by score (descending)
      results.sort((a, b) => b.score - a.score);

      return results.slice(0, limit);
    },

    async rebuild(newPages: PageIndex[]): Promise<void> {
      pages = newPages;
      await this.build();
    },

    suggest(prefix: string, limit: number = 10): string[] {
      if (!prefix) return [];
      const normalized = prefix.toLowerCase().trim();
      if (normalized.length < 2) return [];

      const seen = new Set<string>();

      // Scan inverted index terms for prefix matches (fast path)
      for (const term of invertedIndex.keys()) {
        if (term.startsWith(normalized)) {
          seen.add(term);
          if (seen.size >= limit) return [...seen];
        }
      }

      // Scan page titles — add the full title and also individual words
      for (const doc of documents.values()) {
        if (seen.size >= limit) break;

        const titleLower = doc.titleText;
        if (titleLower.startsWith(normalized)) {
          seen.add(doc.page.title);
          if (seen.size >= limit) break;
        }

        // Individual words within the title (e.g. prefix="dun" matches "Dune CMS")
        if (seen.size < limit) {
          for (const word of tokenize(doc.page.title)) {
            if (word.startsWith(normalized)) {
              seen.add(word);
              if (seen.size >= limit) break;
            }
          }
        }
      }

      return [...seen].slice(0, limit);
    },
  };
}

/** Escape special regex characters in a string */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a dot-path into an object for facet extraction.
 * e.g. "taxonomy.category" → obj.taxonomy?.category
 */
export function resolveFacetValue(
  obj: Record<string, unknown>,
  path: string,
): string | string[] | undefined {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === "string") return cur;
  if (Array.isArray(cur)) {
    return cur.filter((x): x is string => typeof x === "string");
  }
  if (typeof cur === "number" || typeof cur === "boolean") return String(cur);
  return undefined;
}
