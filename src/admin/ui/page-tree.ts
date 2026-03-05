/**
 * Page tree UI — hierarchical page listing with inline actions.
 *
 * Renders a tree view of all pages organized by their content hierarchy.
 * Supports expand/collapse, inline status badges, and action buttons.
 *
 * When a search query is present the tree is replaced by a flat paginated
 * result list rendered by renderSearchResults().
 */

import type { PageIndex } from "../../content/types.ts";

export const PAGES_PER_PAGE = 50;

/** Tree node with children */
interface TreeNode {
  page: PageIndex;
  children: TreeNode[];
}

/**
 * Build a tree structure from a flat page index array.
 */
export function buildPageTree(pages: PageIndex[]): TreeNode[] {
  const sorted = [...pages].sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.order - b.order;
  });

  const roots: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  for (const page of sorted) {
    const node: TreeNode = { page, children: [] };
    nodeMap.set(page.sourcePath, node);

    if (page.parentPath) {
      const parent = nodeMap.get(page.parentPath);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  return roots;
}

/**
 * Render a page tree as HTML.
 */
export function renderPageTree(
  pages: PageIndex[],
  prefix: string,
  knownTemplates: string[] = [],
): string {
  const tree = buildPageTree(pages);

  // Build sorted, deduplicated template list: "default" first, then the rest alpha-sorted
  const pageTemplates = pages.map((p) => p.template).filter(Boolean);
  const allTemplates = [...new Set(["default", ...knownTemplates, ...pageTemplates])].sort(
    (a, b) => (a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b)),
  );

  return `
    <div class="page-tree-toolbar">
      <button class="btn btn-primary btn-sm" onclick="showCreateDialog()">+ New Page</button>
      <form method="GET" action="${prefix}/pages" class="tree-search-form">
        <input type="text" name="q" placeholder="Search pages…" autocomplete="off">
        <button type="submit" class="btn btn-sm btn-outline">Search</button>
      </form>
    </div>
    <div class="page-tree" id="page-tree">
      ${tree.map((node) => renderTreeNode(node, prefix)).join("")}
    </div>
    ${renderCreateDialog(prefix, allTemplates)}
    <script>${pageTreeScript(prefix)}</script>
  `;
}

function renderTreeNode(node: TreeNode, prefix: string, depth = 0): string {
  const { page } = node;
  const hasChildren = node.children.length > 0;
  const indent = depth * 20;
  // Only ordered (numeric-prefix) pages are draggable
  const draggable = page.order > 0;

  return `
    <div class="tree-node" data-path="${escapeAttr(page.sourcePath)}" data-route="${escapeAttr(page.route)}" data-title="${escapeAttr(page.title)}">
      <div class="tree-row" style="padding-left: ${indent + 8}px"
        ${draggable ? `draggable="true"
          ondragstart="handleTreeDragStart(event,'${escapeAttr(page.sourcePath)}')"
          ondragover="handleTreeDragOver(event,'${escapeAttr(page.sourcePath)}')"
          ondragleave="handleTreeDragLeave(event)"
          ondrop="handleTreeDrop(event,'${escapeAttr(page.sourcePath)}')"
          ondragend="handleTreeDragEnd()"` : ""}
      >
        ${draggable ? `<span class="tree-drag-handle" title="Drag to reorder">⠿</span>` : `<span style="width:1rem;flex-shrink:0"></span>`}
        ${hasChildren
          ? `<button class="tree-toggle" onclick="toggleNode(this)" aria-label="Toggle">▶</button>`
          : `<span class="tree-toggle-spacer"></span>`
        }
        <span class="tree-icon">${page.isModule ? "📎" : page.depth === 0 ? "🏠" : "📄"}</span>
        <a href="${prefix}/pages/edit?path=${encodeURIComponent(page.sourcePath)}" class="tree-title">
          ${escapeHtml(page.title || page.route)}
        </a>
        <span class="tree-meta">
          <span class="badge badge-${page.format}">${page.format}</span>
          ${page.published ? "" : `<span class="badge badge-draft">draft</span>`}
        </span>
        <span class="tree-route">${escapeHtml(page.route)}</span>
        <div class="tree-actions">
          <a href="${prefix}/pages/edit?path=${encodeURIComponent(page.sourcePath)}" class="btn btn-xs" title="Edit">✏️</a>
          <a href="${escapeAttr(page.route)}" target="_blank" class="btn btn-xs" title="View">👁️</a>
        </div>
      </div>
      ${hasChildren ? `
        <div class="tree-children">
          ${node.children.map((child) => renderTreeNode(child, prefix, depth + 1)).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderCreateDialog(prefix: string, templates: string[]): string {
  const templateOptions = templates.map((t) =>
    `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`
  ).join("");

  return `
    <div id="create-dialog" class="modal" style="display:none">
      <div class="modal-backdrop" onclick="hideCreateDialog()"></div>
      <div class="modal-content">
        <h3>Create New Page</h3>
        <form id="create-form" onsubmit="createPage(event)">
          <div class="form-group">
            <label for="new-title">Title</label>
            <input type="text" id="new-title" name="title" required>
          </div>
          <div class="form-group">
            <label for="new-path">Path</label>
            <input type="text" id="new-path" name="path" placeholder="parent/page-slug" required>
            <small>Relative to content root, e.g. "02.blog/03.new-post"</small>
          </div>
          <div class="form-group">
            <label for="new-format">Format</label>
            <select id="new-format" name="format">
              <option value="md">Markdown (.md)</option>
              <option value="mdx">MDX (.mdx)</option>
              <option value="tsx">TSX (.tsx)</option>
            </select>
          </div>
          <div class="form-group">
            <label for="new-template">Template</label>
            ${
    templates.length > 1
      ? `<select id="new-template" name="template">${templateOptions}</select>`
      : `<input type="text" id="new-template" name="template" value="default">`
  }
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-outline" onclick="hideCreateDialog()">Cancel</button>
            <button type="submit" class="btn btn-primary">Create</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function pageTreeScript(prefix: string): string {
  return `
    function toggleNode(btn) {
      const node = btn.closest('.tree-node');
      const children = node.querySelector('.tree-children');
      if (children) {
        const collapsed = children.style.display === 'none';
        children.style.display = collapsed ? '' : 'none';
        btn.textContent = collapsed ? '▼' : '▶';
      }
    }

    function showCreateDialog() {
      document.getElementById('create-dialog').style.display = 'flex';
    }

    function hideCreateDialog() {
      document.getElementById('create-dialog').style.display = 'none';
    }

    function createPage(e) {
      e.preventDefault();
      const form = e.target;
      const data = {
        title: form.title.value,
        path: form.path.value,
        format: form.format.value,
        template: form.template.value,
      };
      fetch('${prefix}/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      .then(r => r.json())
      .then(result => {
        if (result.created) {
          window.location.reload();
        } else {
          alert('Error: ' + (result.error || 'Unknown error'));
        }
      })
      .catch(err => alert('Error: ' + err.message));
    }

    // ── Page tree drag-and-drop ──────────────────────────────────────────────
    let treeDragSrc = null;
    let treeDragPos = 'before';

    function clearTreeDragState() {
      treeDragSrc = null;
      document.querySelectorAll('.tree-node').forEach(n => n.classList.remove('tree-dragging'));
      document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('drop-before', 'drop-after'));
    }

    function handleTreeDragStart(e, path) {
      treeDragSrc = path;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', path);
      // Defer adding class so the ghost image renders before the opacity drops
      setTimeout(() => {
        const node = document.querySelector('.tree-node[data-path="' + CSS.escape(path) + '"]');
        if (node) node.classList.add('tree-dragging');
      }, 0);
    }

    function handleTreeDragOver(e, path) {
      if (!treeDragSrc || treeDragSrc === path) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const row = e.currentTarget;
      const rect = row.getBoundingClientRect();
      treeDragPos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      document.querySelectorAll('.tree-row').forEach(r => r.classList.remove('drop-before', 'drop-after'));
      row.classList.add(treeDragPos === 'before' ? 'drop-before' : 'drop-after');
    }

    function handleTreeDragLeave(e) {
      if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
      e.currentTarget.classList.remove('drop-before', 'drop-after');
    }

    function handleTreeDrop(e, targetPath) {
      e.preventDefault();
      clearTreeDragState();
      if (!treeDragSrc || treeDragSrc === targetPath) return;
      const src = treeDragSrc;
      treeDragSrc = null;
      fetch('${prefix}/api/pages/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: src, targetPath, position: treeDragPos }),
      })
      .then(r => r.json())
      .then(result => {
        if (result.reordered) {
          window.location.reload();
        } else {
          alert('Reorder failed: ' + (result.error || 'Unknown error'));
        }
      })
      .catch(err => alert('Reorder failed: ' + err.message));
    }

    function handleTreeDragEnd() {
      clearTreeDragState();
    }
  `;
}

/**
 * Render a flat, paginated search results list in place of the tree.
 * Called when ?q= is present on /admin/pages.
 */
export function renderSearchResults(
  pages: PageIndex[],
  q: string,
  page: number,
  total: number,
  perPage: number,
  prefix: string,
): string {
  const totalPages = Math.ceil(total / perPage);
  const from = total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, total);
  const qEncoded = encodeURIComponent(q);

  const rows = pages.length === 0
    ? `<tr><td colspan="5" class="search-empty">No pages found for "${escapeHtml(q)}"</td></tr>`
    : pages.map((p) => `
      <tr>
        <td><code>${escapeHtml(p.route)}</code></td>
        <td>${escapeHtml(p.title || "")}</td>
        <td><span class="badge badge-${escapeAttr(p.format)}">${escapeHtml(p.format)}</span></td>
        <td>${p.published ? "✅" : '<span class="badge badge-draft">draft</span>'}</td>
        <td class="table-actions">
          <a href="${prefix}/pages/edit?path=${encodeURIComponent(p.sourcePath)}" class="btn btn-xs" title="Edit">✏️</a>
          <a href="${escapeAttr(p.route)}" target="_blank" class="btn btn-xs" title="View">👁️</a>
        </td>
      </tr>`).join("");

  return `
    <div class="page-tree-toolbar">
      <a href="${prefix}/pages" class="btn btn-sm btn-outline">← All pages</a>
      <form method="GET" action="${prefix}/pages" class="tree-search-form">
        <input type="text" name="q" value="${escapeAttr(q)}" placeholder="Search pages…" autocomplete="off" autofocus>
        <button type="submit" class="btn btn-sm btn-outline">Search</button>
      </form>
    </div>
    <p class="search-summary">
      ${total === 0
        ? `No results for <strong>${escapeHtml(q)}</strong>`
        : `Showing ${from}–${to} of ${total} result${total === 1 ? "" : "s"} for <strong>${escapeHtml(q)}</strong>`}
    </p>
    <table class="admin-table">
      <thead>
        <tr>
          <th>Route</th>
          <th>Title</th>
          <th>Format</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${totalPages > 1 ? renderPagination(q, page, totalPages, prefix) : ""}
  `;
}

function renderPagination(q: string, current: number, total: number, prefix: string): string {
  const qParam = `q=${encodeURIComponent(q)}`;
  const pageUrl = (n: number) => `${prefix}/pages?${qParam}&page=${n}`;

  // Build page number window: always show first, last, and up to 3 around current
  const pages: (number | null)[] = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || (i >= current - 2 && i <= current + 2)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== null) {
      pages.push(null); // ellipsis marker
    }
  }

  const items = pages.map((p) =>
    p === null
      ? `<span class="page-ellipsis">…</span>`
      : p === current
      ? `<span class="page-current">${p}</span>`
      : `<a href="${pageUrl(p)}" class="page-link">${p}</a>`
  ).join("");

  return `
    <nav class="pagination">
      ${current > 1
        ? `<a href="${pageUrl(current - 1)}" class="btn btn-sm btn-outline">← Prev</a>`
        : `<span class="btn btn-sm btn-outline disabled">← Prev</span>`}
      <span class="page-numbers">${items}</span>
      ${current < total
        ? `<a href="${pageUrl(current + 1)}" class="btn btn-sm btn-outline">Next →</a>`
        : `<span class="btn btn-sm btn-outline disabled">Next →</span>`}
    </nav>
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
