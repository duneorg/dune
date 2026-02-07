/**
 * Media library UI — grid view of all media files across content pages.
 *
 * Shows thumbnails for images, icons for other file types.
 * Supports filtering by type, search by name, and copy-to-clipboard.
 */

/**
 * Render the media library page content.
 */
export function renderMediaLibrary(prefix: string): string {
  return `
    <div class="media-toolbar">
      <input type="text" class="media-search" id="media-search" placeholder="Search media..." oninput="filterMedia()">
      <select id="media-type-filter" onchange="filterMedia()">
        <option value="all">All types</option>
        <option value="image">Images</option>
        <option value="video">Videos</option>
        <option value="audio">Audio</option>
        <option value="document">Documents</option>
      </select>
      <span class="media-count" id="media-count">Loading...</span>
    </div>
    <div class="media-grid" id="media-grid">
      <p>Loading media files...</p>
    </div>
    ${mediaDetailModal()}
    <script>${mediaLibraryScript(prefix)}</script>
  `;
}

function mediaDetailModal(): string {
  return `
    <div id="media-detail-modal" class="modal" style="display:none">
      <div class="modal-backdrop" onclick="hideMediaDetail()"></div>
      <div class="modal-content modal-wide">
        <div class="media-detail">
          <div class="media-detail-preview" id="detail-preview"></div>
          <div class="media-detail-info" id="detail-info"></div>
        </div>
        <div class="form-actions">
          <button class="btn btn-outline" onclick="hideMediaDetail()">Close</button>
          <button class="btn btn-primary" onclick="copyMediaUrl()">Copy URL</button>
        </div>
      </div>
    </div>
  `;
}

function mediaLibraryScript(prefix: string): string {
  return `
    let allMedia = [];
    let selectedMedia = null;

    // Load media from all pages
    fetch('${prefix}/api/media')
      .then(r => r.json())
      .then(data => {
        allMedia = data.items || [];
        renderMediaGrid(allMedia);
      })
      .catch(() => {
        document.getElementById('media-grid').innerHTML = '<p>Error loading media.</p>';
      });

    function renderMediaGrid(items) {
      const grid = document.getElementById('media-grid');
      document.getElementById('media-count').textContent = items.length + ' files';

      if (items.length === 0) {
        grid.innerHTML = '<p class="media-empty">No media files found.</p>';
        return;
      }

      grid.innerHTML = items.map(item => {
        const isImage = item.type.startsWith('image/');
        return '<div class="media-card" onclick="showMediaDetail(' + JSON.stringify(JSON.stringify(item)) + ')">' +
          (isImage
            ? '<div class="media-card-preview"><img src="' + escapeAttr(item.url) + '?width=200" alt="' + escapeAttr(item.name) + '" loading="lazy"></div>'
            : '<div class="media-card-preview media-card-icon">' + fileIcon(item.type) + '</div>'
          ) +
          '<div class="media-card-info">' +
            '<span class="media-card-name" title="' + escapeAttr(item.name) + '">' + escapeHtml(item.name) + '</span>' +
            '<span class="media-card-meta">' + formatSize(item.size) + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function filterMedia() {
      const query = document.getElementById('media-search').value.toLowerCase();
      const typeFilter = document.getElementById('media-type-filter').value;

      const filtered = allMedia.filter(item => {
        const nameMatch = !query || item.name.toLowerCase().includes(query) || item.pagePath.toLowerCase().includes(query);
        let typeMatch = true;
        if (typeFilter !== 'all') {
          typeMatch = item.type.startsWith(typeFilter + '/');
          if (typeFilter === 'document') {
            typeMatch = item.type.includes('pdf') || item.type.includes('document') || item.type.includes('text');
          }
        }
        return nameMatch && typeMatch;
      });

      renderMediaGrid(filtered);
    }

    function showMediaDetail(itemJson) {
      const item = JSON.parse(itemJson);
      selectedMedia = item;

      const preview = document.getElementById('detail-preview');
      const info = document.getElementById('detail-info');

      if (item.type.startsWith('image/')) {
        preview.innerHTML = '<img src="' + escapeAttr(item.url) + '" alt="' + escapeAttr(item.name) + '">';
      } else {
        preview.innerHTML = '<div class="detail-icon">' + fileIcon(item.type) + '</div>';
      }

      info.innerHTML =
        '<h4>' + escapeHtml(item.name) + '</h4>' +
        '<div class="detail-row"><span>Type:</span> ' + escapeHtml(item.type) + '</div>' +
        '<div class="detail-row"><span>Size:</span> ' + formatSize(item.size) + '</div>' +
        '<div class="detail-row"><span>Page:</span> <code>' + escapeHtml(item.pagePath) + '</code></div>' +
        '<div class="detail-row"><span>URL:</span> <code>' + escapeHtml(item.url) + '</code></div>' +
        '<div class="detail-row"><span>Markdown:</span> <code>![' + escapeHtml(item.name) + '](' + escapeHtml(item.name) + ')</code></div>';

      document.getElementById('media-detail-modal').style.display = 'flex';
    }

    function hideMediaDetail() {
      document.getElementById('media-detail-modal').style.display = 'none';
      selectedMedia = null;
    }

    function copyMediaUrl() {
      if (selectedMedia) {
        navigator.clipboard.writeText(selectedMedia.url).then(() => {
          const btn = event.target;
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = 'Copy URL', 1500);
        });
      }
    }

    function fileIcon(type) {
      if (type.startsWith('video/')) return '🎬';
      if (type.startsWith('audio/')) return '🎵';
      if (type.includes('pdf')) return '📕';
      if (type.includes('zip') || type.includes('archive')) return '📦';
      if (type.includes('text')) return '📝';
      return '📎';
    }

    function formatSize(bytes) {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function escapeHtml(s) {
      return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function escapeAttr(s) {
      return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
  `;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
