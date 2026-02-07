/**
 * Page tree UI — hierarchical page listing with inline actions.
 *
 * Renders a tree view of all pages organized by their content hierarchy.
 * Supports expand/collapse, inline status badges, and action buttons.
 */

import type { PageIndex } from "../../content/types.ts";

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
export function renderPageTree(pages: PageIndex[], prefix: string): string {
  const tree = buildPageTree(pages);

  return `
    <div class="page-tree-toolbar">
      <button class="btn btn-primary btn-sm" onclick="showCreateDialog()">+ New Page</button>
      <input type="text" class="tree-search" placeholder="Filter pages..." oninput="filterTree(this.value)">
    </div>
    <div class="page-tree" id="page-tree">
      ${tree.map((node) => renderTreeNode(node, prefix)).join("")}
    </div>
    ${renderCreateDialog(prefix)}
    <script>${pageTreeScript(prefix)}</script>
  `;
}

function renderTreeNode(node: TreeNode, prefix: string, depth = 0): string {
  const { page } = node;
  const hasChildren = node.children.length > 0;
  const indent = depth * 20;

  return `
    <div class="tree-node" data-path="${escapeAttr(page.sourcePath)}" data-route="${escapeAttr(page.route)}" data-title="${escapeAttr(page.title)}">
      <div class="tree-row" style="padding-left: ${indent + 8}px">
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

function renderCreateDialog(prefix: string): string {
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
            <input type="text" id="new-template" name="template" value="default">
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

    function filterTree(query) {
      const nodes = document.querySelectorAll('.tree-node');
      const q = query.toLowerCase();
      nodes.forEach(node => {
        const title = (node.dataset.title || '').toLowerCase();
        const route = (node.dataset.route || '').toLowerCase();
        const match = !q || title.includes(q) || route.includes(q);
        node.style.display = match ? '' : 'none';
      });
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
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
