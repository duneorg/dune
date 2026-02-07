/**
 * Dune documentation landing page.
 *
 * This is a TSX content page — it IS the content and the template.
 * It dogfoods the very feature it introduces people to.
 */

export const frontmatter = {
  title: "Dune CMS Documentation",
  layout: false,
  published: true,
  visible: true,
  metadata: {
    description: "Documentation for Dune, a flat-file CMS built on Deno Fresh",
  },
  collection: {
    items: { "@self.children": true },
    order: { by: "order", dir: "asc" },
    filter: { visible: true },
  },
};

export default function DocsLanding({ site, collection }: ContentPageProps) {
  return (
    <main>
      <header>
        <h1>Dune CMS</h1>
        <p>A flat-file CMS built on Deno Fresh. Content is files. No database required.</p>
      </header>

      <section>
        <h2>Choose your path</h2>
        <p>Dune serves content editors, webmasters, and developers equally. Pick your starting point:</p>

        <div>
          <div>
            <h3>Content Editor</h3>
            <p>Write pages in Markdown, organize with folders, tag with taxonomies. No code required.</p>
            <p><strong>Start with:</strong> Getting Started → Content → Reference</p>
          </div>

          <div>
            <h3>Webmaster</h3>
            <p>Configure, deploy, and manage a Dune site. YAML config, CLI tools, multiple environments.</p>
            <p><strong>Start with:</strong> Getting Started → Configuration → Deployment</p>
          </div>

          <div>
            <h3>Developer</h3>
            <p>Build themes, write TSX content pages, create plugins, extend the engine.</p>
            <p><strong>Start with:</strong> Getting Started → Content → Themes → Extending</p>
          </div>
        </div>
      </section>

      <section>
        <h2>Documentation Sections</h2>
        <nav>
          {/* This would render the collection of child sections */}
        </nav>
      </section>
    </main>
  );
}
