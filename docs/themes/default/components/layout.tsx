/** @jsxImportSource preact */

/**
 * Default layout component — wraps all pages in a basic document shell.
 * Provides navigation, consistent styling, and page structure.
 */

import type { SiteConfig, DuneConfig } from "../../../../src/config/types.ts";
import type { Page } from "../../../../src/content/types.ts";
import { buildPageTitle } from "../../../../src/content/types.ts";

interface LayoutProps {
  page?: Page;
  site: SiteConfig;
  config?: DuneConfig;
  children?: unknown;
}

export default function Layout({ page, site, children }: LayoutProps) {
  const title = buildPageTitle(page, site.title);

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {site.description && (
          <meta name="description" content={site.description} />
        )}
        <style>{`
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
            line-height: 1.6;
            color: #1a1a1a;
            background: #fafafa;
          }
          .site-header {
            background: #1a1a1a;
            color: white;
            padding: 1rem 2rem;
            display: flex;
            align-items: center;
            gap: 2rem;
          }
          .site-header a { color: white; text-decoration: none; }
          .site-header .logo { font-weight: 700; font-size: 1.2rem; }
          .site-header nav { display: flex; gap: 1.5rem; }
          .site-header nav a { opacity: 0.8; font-size: 0.9rem; }
          .site-header nav a:hover { opacity: 1; }
          .content-wrapper {
            max-width: 800px;
            margin: 2rem auto;
            padding: 0 1.5rem;
          }
          article h1 { font-size: 2rem; margin-bottom: 1rem; color: #111; }
          article h2 { font-size: 1.4rem; margin-top: 2rem; margin-bottom: 0.5rem; color: #222; }
          article h3 { font-size: 1.1rem; margin-top: 1.5rem; margin-bottom: 0.5rem; color: #333; }
          article p { margin-bottom: 1rem; }
          article a { color: #0066cc; }
          article a:hover { text-decoration: underline; }
          article pre {
            background: #f0f0f0;
            padding: 1rem;
            border-radius: 6px;
            overflow-x: auto;
            margin-bottom: 1rem;
            font-size: 0.85rem;
          }
          article code {
            font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
            font-size: 0.9em;
          }
          article :not(pre) > code {
            background: #f0f0f0;
            padding: 0.15rem 0.4rem;
            border-radius: 3px;
          }
          article ul, article ol { margin-bottom: 1rem; padding-left: 1.5rem; }
          article li { margin-bottom: 0.25rem; }
          article table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
          article th, article td {
            border: 1px solid #ddd;
            padding: 0.5rem 0.75rem;
            text-align: left;
          }
          article th { background: #f5f5f5; font-weight: 600; }
          article img { max-width: 100%; border-radius: 4px; }
          article blockquote {
            border-left: 3px solid #ddd;
            padding-left: 1rem;
            margin-bottom: 1rem;
            color: #555;
          }
          .site-footer {
            margin-top: 4rem;
            padding: 2rem;
            text-align: center;
            color: #999;
            font-size: 0.85rem;
            border-top: 1px solid #eee;
          }
        `}</style>
      </head>
      <body>
        <header class="site-header">
          <a class="logo" href="/">{site.title}</a>
          <nav>
            <a href="/getting-started">Getting Started</a>
            <a href="/content">Content</a>
            <a href="/configuration">Configuration</a>
            <a href="/themes">Themes</a>
            <a href="/reference">Reference</a>
          </nav>
        </header>
        <div class="content-wrapper">
          {children}
        </div>
        <footer class="site-footer">
          Powered by Dune — flat-file CMS for Deno
        </footer>
      </body>
    </html>
  );
}
