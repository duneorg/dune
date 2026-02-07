/**
 * TSX Pages documentation — written AS a TSX content page.
 *
 * This page dogfoods the feature it documents.
 * It's a .tsx file in the content directory, with exported frontmatter,
 * demonstrating exactly how TSX content pages work.
 */

export const frontmatter = {
  title: "TSX Content Pages",
  published: true,
  visible: true,
  layout: "default",
  taxonomy: {
    audience: ["developer"],
    difficulty: ["intermediate"],
    topic: ["content", "tsx"],
  },
  metadata: {
    description: "Building interactive content pages with TSX",
  },
};

export default function TsxPagesDoc({ site, media }: ContentPageProps) {
  return (
    <article>
      <h1>TSX Content Pages</h1>

      <aside>
        <p>
          <strong>You're reading a TSX content page right now.</strong> This
          documentation page is itself a <code>.tsx</code> file in the content
          directory, demonstrating the feature it describes.
        </p>
      </aside>

      <p>
        TSX content pages are full JSX components that serve as both content
        AND template. They're ideal for landing pages, interactive demos, or
        any page where you need full programmatic control.
      </p>

      <h2>How it works</h2>

      <p>
        A TSX content page is a <code>.tsx</code> file in your content
        directory that exports two things:
      </p>

      <ol>
        <li>
          <code>export const frontmatter</code> — a static object with your
          page metadata (title, date, taxonomies, etc.)
        </li>
        <li>
          <code>export default function</code> — a JSX component that IS the
          page content
        </li>
      </ol>

      <h2>Minimal example</h2>

      <pre><code>{`// content/04.landing/page.tsx

export const frontmatter = {
  title: "My Landing Page",
  date: "2025-06-15",
  published: true,
  taxonomy: {
    tag: ["showcase"],
  },
};

export default function LandingPage({ site, media }) {
  return (
    <article>
      <h1>{frontmatter.title}</h1>
      <p>Welcome to {site.title}!</p>
      <img src={media.url("hero.jpg")} alt="Hero" />
    </article>
  );
}`}</code></pre>

      <h2>Frontmatter options</h2>

      <p>
        TSX pages support the same frontmatter fields as Markdown pages — title,
        date, taxonomies, collections, visibility, caching. The difference is
        how frontmatter is declared:
      </p>

      <h3>Inline frontmatter (in the .tsx file)</h3>

      <pre><code>{`export const frontmatter = {
  title: "Page Title",
  date: "2025-06-15",
  taxonomy: { tag: ["demo"] },
};`}</code></pre>

      <p>
        <strong>Constraint:</strong> The frontmatter object must be a static,
        JSON-compatible literal. No function calls, no variable references, no
        imports. This is because Dune extracts frontmatter during indexing
        without executing your code.
      </p>

      <h3>Sidecar YAML (separate file)</h3>

      <p>
        For complex frontmatter or if you prefer YAML, create a sidecar file
        next to your TSX file:
      </p>

      <pre><code>{`# content/04.landing/page.frontmatter.yaml
title: "Page Title"
date: 2025-06-15
taxonomy:
  tag: [demo]
  category: [showcase]
collection:
  items:
    "@self.children": true
  order:
    by: date
    dir: desc`}</code></pre>

      <p>
        The sidecar file takes precedence. If both exist, the YAML sidecar
        is used and the inline export is ignored for indexing purposes.
      </p>

      <h2>Layout control</h2>

      <p>
        TSX pages render themselves — they don't need a theme template. But
        you can still opt into wrapping with a theme layout:
      </p>

      <pre><code>{`export const frontmatter = {
  title: "My Page",

  // Layout options:
  // layout: "default"   → wrap in theme's default layout (this IS the default)
  // layout: "landing"   → wrap in a specific layout component
  // layout: false        → no wrapper — you control everything including <html>
};`}</code></pre>

      <h2>What TSX pages can do</h2>

      <ul>
        <li>Import and use Fresh islands (interactive client components)</li>
        <li>Import theme components (layouts, partials, design tokens)</li>
        <li>Import from npm and JSR packages</li>
        <li>Access co-located media via the <code>media</code> prop</li>
        <li>Use collections defined in their frontmatter</li>
        <li>Full TypeScript type safety</li>
      </ul>

      <h2>When to use TSX vs Markdown</h2>

      <table>
        <thead>
          <tr>
            <th>Choose Markdown when...</th>
            <th>Choose TSX when...</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Content is mostly prose</td>
            <td>Page needs custom layout or design</td>
          </tr>
          <tr>
            <td>Non-developers will edit it</td>
            <td>Page includes interactive elements</td>
          </tr>
          <tr>
            <td>Standard blog/docs layout works</td>
            <td>You need programmatic control</td>
          </tr>
          <tr>
            <td>Quick authoring matters most</td>
            <td>Type safety and component reuse matter</td>
          </tr>
        </tbody>
      </table>
    </article>
  );
}
