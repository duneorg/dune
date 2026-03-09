/**
 * Built-in search page — generates a complete HTML page for the /search route.
 *
 * Used as a fallback when the active theme does not provide a "search" template.
 * The page includes:
 *   - A server-rendered search form pre-filled with the current query
 *   - Server-rendered results list (for SEO / non-JS environments)
 *   - Inline JS for live search (debounced fetch to /api/search)
 */

import type { SiteConfig } from "../config/types.ts";

export interface SearchResult {
  route: string;
  title: string;
  excerpt: string;
  score: number;
}

export interface SearchPageOptions {
  /** The search query (decoded, may be empty string) */
  query: string;
  /** Ranked results from the search engine */
  results: SearchResult[];
  /** Site configuration for title and branding */
  site: SiteConfig;
  /** Base URL of the site (e.g. "https://example.com") */
  siteUrl: string;
}

/** Escape a string for safe embedding inside HTML attribute values and text content. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generate a complete HTML page for the /search route.
 *
 * Returns a fully self-contained HTML string that works without JavaScript
 * (server-rendered results) and progressively enhances with live search.
 */
export function generateSearchPage(options: SearchPageOptions): string {
  const { query, results, site, siteUrl } = options;
  const base = siteUrl.replace(/\/$/, "");
  const safeQuery = escapeHtml(query);
  const siteName = escapeHtml(site.title);
  const pageTitle = query
    ? `Search: ${safeQuery} | ${siteName}`
    : `Search | ${siteName}`;

  const resultItems = results.map((r) => `
    <li class="search-result">
      <a href="${escapeHtml(base + r.route)}" class="search-result-title">${escapeHtml(r.title)}</a>
      <p class="search-result-excerpt">${escapeHtml(r.excerpt)}</p>
      <span class="search-result-route">${escapeHtml(r.route)}</span>
    </li>`).join("");

  const resultsSection = query
    ? results.length > 0
      ? `<ul id="search-results" class="search-results">${resultItems}\n  </ul>`
      : `<ul id="search-results" class="search-results"></ul>
  <p id="search-empty" class="search-empty">No results found for <strong>${safeQuery}</strong>.</p>`
    : `<ul id="search-results" class="search-results"></ul>
  <p id="search-empty" class="search-empty" style="display:none"></p>`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(site.metadata?.language ?? "en")}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      max-width: 720px;
      margin: 0 auto;
      padding: 2rem 1.5rem;
      color: #1a1a1a;
      line-height: 1.6;
    }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .search-header { margin-bottom: 2rem; }
    .search-header h1 { font-size: 1.75rem; margin: 0 0 1rem; }
    .search-form { display: flex; gap: 0.5rem; }
    .search-input {
      flex: 1;
      padding: 0.6rem 0.9rem;
      font-size: 1rem;
      border: 1px solid #ccc;
      border-radius: 4px;
    }
    .search-input:focus { outline: 2px solid #0066cc; border-color: transparent; }
    .search-button {
      padding: 0.6rem 1.2rem;
      font-size: 1rem;
      background: #0066cc;
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
    }
    .search-button:hover { background: #0052a3; }
    .search-results { list-style: none; padding: 0; margin: 0; }
    .search-result { padding: 1rem 0; border-bottom: 1px solid #eee; }
    .search-result:last-child { border-bottom: none; }
    .search-result-title { font-size: 1.1rem; font-weight: 600; }
    .search-result-excerpt { color: #555; margin: 0.25rem 0; font-size: 0.95rem; }
    .search-result-route { font-size: 0.8rem; color: #888; }
    .search-empty { color: #666; font-style: italic; }
    .search-status { font-size: 0.875rem; color: #666; margin-bottom: 1rem; }
    .site-link { display: inline-block; margin-bottom: 1.5rem; font-size: 0.9rem; color: #666; }
  </style>
</head>
<body>
  <a href="${escapeHtml(base + "/")}" class="site-link">← ${siteName}</a>
  <div class="search-header">
    <h1>Search</h1>
    <form action="/search" method="get" class="search-form" id="search-form">
      <input
        type="search"
        name="q"
        id="search-input"
        class="search-input"
        value="${safeQuery}"
        placeholder="Search…"
        autocomplete="off"
        autofocus
        aria-label="Search query"
      >
      <button type="submit" class="search-button">Search</button>
    </form>
  </div>
  <div id="search-status" class="search-status" aria-live="polite"></div>
  ${resultsSection}
  <script>
    (function () {
      var input = document.getElementById('search-input');
      var resultsList = document.getElementById('search-results');
      var emptyMsg = document.getElementById('search-empty');
      var statusEl = document.getElementById('search-status');
      var debounceTimer;

      function renderResults(items, query) {
        resultsList.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'none';
        if (!query) { statusEl.textContent = ''; return; }
        if (items.length === 0) {
          if (emptyMsg) {
            emptyMsg.innerHTML = 'No results found for <strong>' + escapeHtml(query) + '</strong>.';
            emptyMsg.style.display = '';
          }
          statusEl.textContent = '';
          return;
        }
        statusEl.textContent = items.length + ' result' + (items.length === 1 ? '' : 's');
        items.forEach(function (r) {
          var li = document.createElement('li');
          li.className = 'search-result';
          li.innerHTML =
            '<a href="' + escapeHtml(r.route) + '" class="search-result-title">' + escapeHtml(r.title) + '</a>' +
            '<p class="search-result-excerpt">' + escapeHtml(r.excerpt) + '</p>' +
            '<span class="search-result-route">' + escapeHtml(r.route) + '</span>';
          resultsList.appendChild(li);
        });
      }

      function escapeHtml(s) {
        return String(s)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      }

      function doSearch(query) {
        if (!query) { renderResults([], ''); return; }
        fetch('/api/search?q=' + encodeURIComponent(query) + '&limit=20')
          .then(function (r) { return r.json(); })
          .then(function (data) { renderResults(data.items || [], query); })
          .catch(function () {});
      }

      if (input) {
        input.addEventListener('input', function () {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function () { doSearch(input.value.trim()); }, 250);
        });
      }

      // Prevent full page reload on form submit — handle via JS instead
      var form = document.getElementById('search-form');
      if (form) {
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var q = input ? input.value.trim() : '';
          history.replaceState(null, '', '/search' + (q ? '?q=' + encodeURIComponent(q) : ''));
          doSearch(q);
        });
      }
    })();
  </script>
</body>
</html>`;
}
