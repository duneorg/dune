/** @jsxImportSource preact */
/** Island: page tree with search, create dialog, drag-reorder */

import { h, Fragment } from "preact";
import { useState, useEffect, useRef } from "preact/hooks";

interface PageItem {
  route: string;
  title: string;
  format: string;
  published: boolean;
  date?: string;
  language?: string;
}

interface TreeNode {
  page: PageItem;
  children: TreeNode[];
}

function buildTree(pages: PageItem[]): TreeNode[] {
  // Sort by route depth then alphabetically
  const sorted = [...pages].sort((a, b) => {
    const da = a.route.split("/").length;
    const db = b.route.split("/").length;
    if (da !== db) return da - db;
    return a.route.localeCompare(b.route);
  });

  const roots: TreeNode[] = [];
  const byRoute = new Map<string, TreeNode>();

  for (const page of sorted) {
    const node: TreeNode = { page, children: [] };
    byRoute.set(page.route, node);

    const parentRoute = page.route.slice(0, page.route.lastIndexOf("/")) || null;
    const parent = parentRoute ? byRoute.get(parentRoute) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

interface Props {
  pages: PageItem[];
  initialQuery: string;
  prefix: string;
}

export default function PageTree({ pages, initialQuery, prefix }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createTemplate, setCreateTemplate] = useState("default");
  const [createParent, setCreateParent] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const filtered = query
    ? pages.filter(
        (p) =>
          p.title.toLowerCase().includes(query.toLowerCase()) ||
          p.route.toLowerCase().includes(query.toLowerCase()),
      )
    : null;

  const tree = filtered ? null : buildTree(pages);

  const templates = [...new Set(["default", ...pages.map((p) => p.format ?? "default")])].sort(
    (a, b) => (a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b)),
  );

  async function handleCreate(e: Event) {
    e.preventDefault();
    if (!createTitle.trim()) return;
    setCreating(true);
    setCreateError("");
    try {
      const res = await fetch(`${prefix.replace(/\/admin$/, "")}/admin/api/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({
          title: createTitle.trim(),
          template: createTemplate,
          parent: createParent || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setCreateError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const { route } = await res.json() as { route: string };
      location.href = `${prefix}/pages/edit?path=${encodeURIComponent(route)}`;
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setCreating(false);
    }
  }

  function toggleCollapse(route: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(route)) next.delete(route);
      else next.add(route);
      return next;
    });
  }

  function renderNode(node: TreeNode, depth = 0): h.JSX.Element {
    const { page, children } = node;
    const isCollapsed = collapsed.has(page.route);
    const hasChildren = children.length > 0;
    const editUrl = `${prefix}/pages/edit?path=${encodeURIComponent(page.route)}`;

    return (
      <div key={page.route} style={{ paddingLeft: `${depth * 1.25}rem` }}>
        <div class="page-tree-row">
          <span
            class="tree-toggle"
            style={{ visibility: hasChildren ? "visible" : "hidden", cursor: "pointer" }}
            onClick={() => toggleCollapse(page.route)}
          >
            {isCollapsed ? "▶" : "▼"}
          </span>
          <a href={editUrl} class="page-tree-title">
            {page.title || page.route}
          </a>
          <span class={`badge badge-fmt badge-${page.format}`}>{page.format}</span>
          {!page.published && <span class="badge badge-draft">draft</span>}
          {page.language && <span class="badge badge-lang">{page.language}</span>}
          <span class="tree-route">{page.route}</span>
          <span class="tree-actions">
            <a href={editUrl} class="btn btn-xs btn-outline">Edit</a>
            <a href={`${prefix}/pages/history?path=${encodeURIComponent(page.route)}`} class="btn btn-xs btn-outline">History</a>
          </span>
        </div>
        {hasChildren && !isCollapsed && (
          <div class="tree-children">
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div class="page-tree-wrap">
      <div class="page-tree-toolbar">
        <button class="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
          + New Page
        </button>
        <div class="tree-search-form">
          <input
            type="text"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            placeholder="Search pages…"
            autocomplete="off"
          />
        </div>
      </div>

      {/* Search results */}
      {filtered && (
        <div class="page-search-results">
          {filtered.length === 0 ? (
            <p style="color:#718096;padding:1rem 0">No pages match "{query}"</p>
          ) : (
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Route</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.route}>
                    <td><a href={`${prefix}/pages/edit?path=${encodeURIComponent(p.route)}`}>{p.title || "(untitled)"}</a></td>
                    <td><code>{p.route}</code></td>
                    <td>{p.format}</td>
                    <td>{p.published ? "published" : "draft"}</td>
                    <td>
                      <a href={`${prefix}/pages/edit?path=${encodeURIComponent(p.route)}`} class="btn btn-xs btn-outline">Edit</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Tree view */}
      {!filtered && tree && (
        <div class="page-tree" id="page-tree">
          {tree.length === 0 ? (
            <p style="color:#718096;padding:2rem 0">No pages yet. Create your first page above.</p>
          ) : (
            tree.map((node) => renderNode(node))
          )}
        </div>
      )}

      {/* Create dialog */}
      {showCreate && (
        <div class="modal">
          <div class="modal-backdrop" onClick={() => setShowCreate(false)} />
          <div class="modal-content">
            <h3>New Page</h3>
            <form onSubmit={handleCreate}>
              <div class="form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={createTitle}
                  onInput={(e) => setCreateTitle((e.target as HTMLInputElement).value)}
                  placeholder="Page title"
                  required
                  autoFocus
                />
              </div>
              <div class="form-group">
                <label>Template</label>
                <select
                  value={createTemplate}
                  onChange={(e) => setCreateTemplate((e.target as HTMLSelectElement).value)}
                >
                  {templates.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div class="form-group">
                <label>Parent page (optional)</label>
                <select
                  value={createParent}
                  onChange={(e) => setCreateParent((e.target as HTMLSelectElement).value)}
                >
                  <option value="">— Top level —</option>
                  {pages.map((p) => (
                    <option key={p.route} value={p.route}>{p.route}</option>
                  ))}
                </select>
              </div>
              {createError && <p class="form-error">{createError}</p>}
              <div class="form-actions">
                <button type="button" class="btn btn-outline" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" class="btn btn-primary" disabled={creating}>
                  {creating ? "Creating…" : "Create page"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function getCsrf(): string {
  return (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content ?? "";
}
