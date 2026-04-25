/** @jsxImportSource preact */

interface LayoutProps {
  page?: any;
  pageTitle?: string;
  site: any;
  config?: any;
  pathname?: string;
  children?: unknown;
}

type NavItem = { href: string; label: string; children?: Array<{ href: string; label: string }> };

const sections: NavItem[] = [
  { href: "/getting-started", label: "Getting Started", children: [
    { href: "/getting-started/installation", label: "Installation" },
    { href: "/getting-started/quickstart", label: "Quickstart" },
    { href: "/getting-started/project-structure", label: "Project Structure" },
    { href: "/getting-started/migration", label: "Migration" },
  ]},
  { href: "/content", label: "Content", children: [
    { href: "/content/markdown", label: "Markdown Pages" },
    { href: "/content/tsx-pages", label: "TSX Pages" },
    { href: "/content/frontmatter", label: "Frontmatter" },
    { href: "/content/collections", label: "Collections" },
    { href: "/content/taxonomies", label: "Taxonomies" },
    { href: "/content/media", label: "Media" },
    { href: "/content/i18n", label: "Multilingual" },
    { href: "/content/workflow", label: "Workflow" },
    { href: "/content/machine-translation", label: "Machine Translation" },
    { href: "/content/page-builder", label: "Page Builder" },
  ]},
  { href: "/configuration", label: "Configuration", children: [
    { href: "/configuration/site-config", label: "Site Config" },
    { href: "/configuration/system-config", label: "System Config" },
    { href: "/configuration/programmatic-config", label: "Programmatic Config" },
  ]},
  { href: "/themes", label: "Themes", children: [
    { href: "/themes/templates", label: "Templates" },
    { href: "/themes/inheritance", label: "Inheritance" },
    { href: "/themes/creating-a-theme", label: "Creating a Theme" },
    { href: "/themes/preview-and-marketplace", label: "Preview & Marketplace" },
    { href: "/themes/islands", label: "Islands" },
  ]},
  { href: "/deployment", label: "Deployment", children: [
    { href: "/deployment/deno-deploy", label: "Deno Deploy" },
    { href: "/deployment/traditional-server", label: "Traditional Server" },
    { href: "/deployment/sitemap", label: "Sitemap" },
    { href: "/deployment/feeds", label: "RSS & Atom Feeds" },
    { href: "/deployment/static", label: "Static Site Generation" },
    { href: "/deployment/caching", label: "HTTP Caching" },
  ]},
  { href: "/extending", label: "Extending", children: [
    { href: "/extending/hooks", label: "Hooks" },
    { href: "/extending/format-handlers", label: "Format Handlers" },
    { href: "/extending/mdx-content", label: "MDX Content" },
    { href: "/extending/plugins", label: "Plugins" },
  ]},
  { href: "/reference", label: "Reference", children: [
    { href: "/reference/cli", label: "CLI Commands" },
    { href: "/reference/api", label: "REST API" },
    { href: "/reference/config-schema", label: "Config Schema" },
    { href: "/reference/search", label: "Search" },
    { href: "/reference/stability", label: "API Stability" },
  ]},
  { href: "/administration", label: "Administration", children: [
    { href: "/administration/audit-log", label: "Audit Log" },
    { href: "/administration/performance", label: "Performance" },
    { href: "/administration/auth-providers", label: "Auth Providers" },
    { href: "/administration/marketplace", label: "Marketplace" },
  ]},
  { href: "/flex-objects", label: "Flex Objects" },
  { href: "/forms", label: "Forms" },
  { href: "/webhooks", label: "Webhooks" },
  { href: "/comments", label: "Comments" },
  { href: "/multi-site", label: "Multi-site" },
];

export default function Layout({ page, pageTitle, site, config, pathname, children }: LayoutProps) {
  const themeName = config?.theme?.name ?? "default";
  const currentPath = pathname ?? page?.route ?? "/";
  const resolvedTitle = pageTitle
    ? `${pageTitle} — ${site?.title ?? "Dune Docs"}`
    : (site?.title ?? "Dune Docs");

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{resolvedTitle}</title>
        {site?.description && <meta name="description" content={site.description} />}
        <link rel="stylesheet" href={`/themes/${themeName}/static/style.css`} />
      </head>
      <body>
        <header class="site-header">
          <a class="header-logo" href="/">Dune</a>
          <nav class="header-nav">
            <a href="https://getdune.org" target="_blank" rel="noopener">getdune.org</a>
            <a href="https://github.com/duneorg/dune" target="_blank" rel="noopener">GitHub</a>
            <a href="https://jsr.io/@dune/core" target="_blank" rel="noopener">JSR</a>
          </nav>
        </header>

        <div class="docs-layout">
          <aside class="docs-sidebar">
            <div class="sidebar-search">
              <input
                id="docs-search"
                type="search"
                placeholder="Search docs…"
                autocomplete="off"
                aria-label="Search documentation"
              />
              <div id="search-results" class="search-results" hidden></div>
            </div>

            <nav class="sidebar-nav" aria-label="Documentation">
              {sections.map((s) => {
                const isRoot = s.href === "/";
                const sectionActive = currentPath === s.href ||
                  (!isRoot && currentPath.startsWith(s.href + "/"));
                return (
                  <div key={s.href} class="nav-section">
                    <a href={s.href} class={sectionActive ? "active" : ""}>{s.label}</a>
                    {sectionActive && s.children && s.children.length > 0 && (
                      <div class="nav-children">
                        {s.children.map((c) => (
                          <a key={c.href} href={c.href} class={currentPath === c.href ? "active" : ""}>
                            {c.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </aside>

          <div class="docs-content">
            {children}
          </div>
        </div>

        <footer class="site-footer">
          Dune — flat-file CMS for Deno ·{" "}
          <a href="https://github.com/duneorg/dune" target="_blank" rel="noopener">GitHub</a>
        </footer>

        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var input = document.getElementById('docs-search');
            var results = document.getElementById('search-results');
            if (!input || !results) return;

            var timer;
            input.addEventListener('input', function() {
              clearTimeout(timer);
              var q = input.value.trim();
              if (!q) { results.hidden = true; results.innerHTML = ''; return; }
              timer = setTimeout(function() { doSearch(q); }, 200);
            });

            input.addEventListener('keydown', function(e) {
              if (e.key === 'Escape') { input.value = ''; results.hidden = true; results.innerHTML = ''; }
            });

            document.addEventListener('click', function(e) {
              if (!input.contains(e.target) && !results.contains(e.target)) {
                results.hidden = true;
              }
            });

            function doSearch(q) {
              fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=8')
                .then(function(r) { return r.json(); })
                .then(function(data) {
                  var hits = data.items || [];
                  if (!hits.length) {
                    results.innerHTML = '<div class="search-empty">No results</div>';
                    results.hidden = false;
                    return;
                  }
                  results.innerHTML = hits.map(function(h) {
                    return '<a class="search-hit" href="' + h.route + '">' +
                      '<span class="search-hit-title">' + esc(h.title) + '</span>' +
                      '<span class="search-hit-excerpt">' + esc(h.excerpt || '') + '</span>' +
                      '</a>';
                  }).join('');
                  results.hidden = false;
                })
                .catch(function() { results.hidden = true; });
            }

            function esc(s) {
              return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            }
          })();
        `}} />
      </body>
    </html>
  );
}
