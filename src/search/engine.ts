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
}

export interface SearchResult {
  /** The matched page */
  page: PageIndex;
  /** Relevance score (higher = better) */
  score: number;
  /** Matching excerpt/context around the hit */
  excerpt: string;
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
  /** Title (for boosted scoring) */
  title: string;
  /** The PageIndex entry */
  page: PageIndex;
}

/**
 * Create a search engine.
 */
export function createSearchEngine(
  options: SearchEngineOptions,
): SearchEngine {
  let { pages, storage, contentDir, formats } = options;

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
    const titleTerms = tokenize(doc.title);

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
   * Extract searchable text from a page's content.
   */
  async function extractText(page: PageIndex): Promise<string> {
    const parts: string[] = [
      page.title,
      page.template,
    ];

    // Add taxonomy values
    for (const values of Object.values(page.taxonomy)) {
      parts.push(...values);
    }

    // Try to read the content file for body text and custom frontmatter fields.
    // Both extractions share a single file read.
    try {
      const filePath = `${contentDir}/${page.sourcePath}`;
      const raw = await storage.readText(filePath);
      const handler = formats.getForFile(page.sourcePath);

      if (handler) {
        const body = handler.extractBody(raw, filePath);
        if (body) {
          // Strip markdown/HTML for plain text
          const plain = body
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
          parts.push(plain);
        }

        // Extract custom frontmatter fields (same raw file, no extra I/O)
        const customFields = options.customFields;
        if (customFields?.length) {
          const fm = await handler.extractFrontmatter(raw, filePath);
          for (const field of customFields) {
            const val = fm[field];
            if (typeof val === "string") {
              parts.push(val);
            } else if (Array.isArray(val)) {
              for (const item of val) {
                if (typeof item === "string") parts.push(item);
              }
            }
          }
        }
      }
    } catch {
      // Content file not readable — index only metadata
    }

    return parts.join(" ");
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
  ): { score: number; excerpt: string } {
    let score = 0;
    const titleLower = doc.title.toLowerCase();
    const textLower = doc.text;

    for (let i = 0; i < queryTerms.length; i++) {
      const term = queryTerms[i];
      // Title match (boosted 3x)
      if (titleLower.includes(term)) {
        score += 3;
        // Exact title match (boosted extra)
        if (titleLower === term) score += 5;
      }

      // Body match — use pre-compiled regexp (no per-document construction)
      const bodyMatches = (textLower.match(termRegexps[i]) || []).length;
      score += Math.min(bodyMatches, 5); // Cap at 5 per term

      // Taxonomy match (boosted 2x)
      for (const values of Object.values(doc.page.taxonomy)) {
        for (const val of values) {
          if (val.toLowerCase().includes(term)) score += 2;
        }
      }
    }

    // Multi-term bonus: if all terms match, boost score
    const allMatch = queryTerms.every(
      (term) => textLower.includes(term),
    );
    if (allMatch && queryTerms.length > 1) score *= 1.5;

    // Extract excerpt around first match
    let excerpt = "";
    for (const term of queryTerms) {
      const idx = textLower.indexOf(term);
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(textLower.length, idx + term.length + 60);
        excerpt = (start > 0 ? "..." : "") +
          doc.text.slice(start, end).trim() +
          (end < textLower.length ? "..." : "");
        break;
      }
    }

    if (!excerpt) {
      excerpt = doc.text.slice(0, 120).trim() + "...";
    }

    return { score, excerpt };
  }

  return {
    async build(): Promise<void> {
      invertedIndex.clear();
      documents.clear();

      for (const page of pages) {
        if (!page.published) continue;
        if (!page.routable) continue;

        const text = await extractText(page);
        indexDocument({
          sourcePath: page.sourcePath,
          text,
          title: page.title,
          page,
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

        const { score, excerpt } = scoreDocument(doc, queryTerms, termRegexps);
        if (score > 0) {
          results.push({ page: doc.page, score, excerpt });
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

        const titleLower = doc.title.toLowerCase();
        if (titleLower.startsWith(normalized)) {
          seen.add(doc.title);
          if (seen.size >= limit) break;
        }

        // Individual words within the title (e.g. prefix="dun" matches "Dune CMS")
        if (seen.size < limit) {
          for (const word of tokenize(doc.title)) {
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
