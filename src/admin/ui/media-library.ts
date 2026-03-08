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
        <div id="focal-section" style="display:none">
          <h5 style="margin:0.75rem 0 0.5rem">Focal Point</h5>
          <div class="focal-picker-wrap" id="focal-picker" onclick="handleFocalClick(event)">
            <img id="focal-img" src="" alt="">
            <div class="focal-dot" id="focal-dot"></div>
          </div>
          <div class="focal-coords" id="focal-coords">50%, 50%</div>
          <div class="focal-previews">
            <div>
              <div class="focal-preview" style="width:160px;height:90px">
                <img id="focal-preview-16-9" src="" alt="">
              </div>
              <div class="focal-preview-label">16:9</div>
            </div>
            <div>
              <div class="focal-preview" style="width:90px;height:90px">
                <img id="focal-preview-1-1" src="" alt="">
              </div>
              <div class="focal-preview-label">1:1</div>
            </div>
          </div>
          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-sm btn-primary" onclick="saveFocalPoint()">Save focal point</button>
            <button class="btn btn-sm btn-outline" onclick="clearFocalPoint()">Clear</button>
          </div>
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

    // Validate a URL is a safe relative or same-origin URL (not javascript: or data:)
    function isSafeUrl(url) {
      if (!url || typeof url !== 'string') return false;
      const lower = url.toLowerCase().trimStart();
      if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('vbscript:')) return false;
      return url.startsWith('/') || url.startsWith('./') || url.startsWith('../') || /^https?:\/\//.test(url);
    }

    function renderMediaGrid(items) {
      const grid = document.getElementById('media-grid');
      document.getElementById('media-count').textContent = items.length + ' files';

      if (items.length === 0) {
        grid.innerHTML = '<p class="media-empty">No media files found.</p>';
        return;
      }

      // Use data-index attribute instead of embedding JSON in onclick attributes
      // to avoid XSS through double-JSON serialization of filenames.
      grid.innerHTML = items.map((item, index) => {
        const isImage = item.type.startsWith('image/');
        const safeUrl = isSafeUrl(item.url) ? item.url : '';
        return '<div class="media-card" data-index="' + index + '">' +
          (isImage && safeUrl
            ? '<div class="media-card-preview"><img src="' + escapeAttr(safeUrl) + '?width=200" alt="' + escapeAttr(item.name) + '" loading="lazy"></div>'
            : '<div class="media-card-preview media-card-icon">' + fileIcon(item.type) + '</div>'
          ) +
          '<div class="media-card-info">' +
            '<span class="media-card-name" title="' + escapeAttr(item.name) + '">' + escapeHtml(item.name) + '</span>' +
            '<span class="media-card-meta">' + formatSize(item.size) + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Delegated click handler — avoids inline event handlers with embedded data
    document.addEventListener('click', function(e) {
      const card = e.target.closest('.media-card[data-index]');
      if (!card) return;
      const index = parseInt(card.dataset.index, 10);
      if (!isNaN(index) && allMedia[index]) {
        showMediaDetail(allMedia[index]);
      }
    });

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

    function showMediaDetail(item) {
      selectedMedia = item;

      const preview = document.getElementById('detail-preview');
      const info = document.getElementById('detail-info');

      const safeUrl = isSafeUrl(item.url) ? item.url : '';
      if (item.type.startsWith('image/') && safeUrl) {
        preview.innerHTML = '<img src="' + escapeAttr(safeUrl) + '" alt="' + escapeAttr(item.name) + '">';
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

      // Show focal picker for images
      if (item.type.startsWith('image/') && safeUrl) {
        initFocalPicker(item, safeUrl);
      } else {
        document.getElementById('focal-section').style.display = 'none';
      }

      document.getElementById('media-detail-modal').style.display = 'flex';
    }

    // ── Focal point picker ────────────────────────────────────────────────────

    let focalX = 50;
    let focalY = 50;

    function initFocalPicker(item, safeUrl) {
      const section = document.getElementById('focal-section');
      section.style.display = 'block';

      // Pre-populate from saved meta
      const saved = item.meta && Array.isArray(item.meta.focal) ? item.meta.focal : [50, 50];
      focalX = typeof saved[0] === 'number' ? saved[0] : 50;
      focalY = typeof saved[1] === 'number' ? saved[1] : 50;

      // Wire up picker image
      const focalImg = document.getElementById('focal-img');
      focalImg.src = safeUrl;

      // Wire up preview images
      document.getElementById('focal-preview-16-9').src = safeUrl;
      document.getElementById('focal-preview-1-1').src = safeUrl;

      setFocalPoint(focalX, focalY);
    }

    function setFocalPoint(x, y) {
      focalX = Math.max(0, Math.min(100, Math.round(x)));
      focalY = Math.max(0, Math.min(100, Math.round(y)));

      // Move crosshair dot
      const dot = document.getElementById('focal-dot');
      dot.style.left = focalX + '%';
      dot.style.top = focalY + '%';

      // Update coordinate label
      document.getElementById('focal-coords').textContent = focalX + '%, ' + focalY + '%';

      // Update preview crops via object-position
      const pos = focalX + '% ' + focalY + '%';
      document.getElementById('focal-preview-16-9').style.objectPosition = pos;
      document.getElementById('focal-preview-1-1').style.objectPosition = pos;
    }

    function handleFocalClick(e) {
      const wrap = document.getElementById('focal-picker');
      const rect = wrap.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setFocalPoint(x, y);
    }

    function saveFocalPoint() {
      if (!selectedMedia) return;
      const btn = event.target;
      btn.textContent = 'Saving…';
      btn.disabled = true;
      fetch('${prefix}/api/media/meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagePath: selectedMedia.pagePath, name: selectedMedia.name, focal: [focalX, focalY] }),
      })
      .then(r => r.json())
      .then(result => {
        if (result.ok) {
          // Persist focal into the in-memory item so re-opening shows the saved value
          if (!selectedMedia.meta) selectedMedia.meta = {};
          selectedMedia.meta.focal = [focalX, focalY];
          btn.textContent = 'Saved!';
          setTimeout(() => { btn.textContent = 'Save focal point'; btn.disabled = false; }, 1500);
        } else {
          alert('Error: ' + (result.error || 'Unknown error'));
          btn.textContent = 'Save focal point';
          btn.disabled = false;
        }
      })
      .catch(err => {
        alert('Error: ' + err.message);
        btn.textContent = 'Save focal point';
        btn.disabled = false;
      });
    }

    function clearFocalPoint() {
      if (!selectedMedia) return;
      const btn = event.target;
      btn.textContent = 'Clearing…';
      btn.disabled = true;
      fetch('${prefix}/api/media/meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pagePath: selectedMedia.pagePath, name: selectedMedia.name, focal: null }),
      })
      .then(r => r.json())
      .then(result => {
        if (result.ok) {
          if (selectedMedia.meta) delete selectedMedia.meta.focal;
          setFocalPoint(50, 50);
          btn.textContent = 'Clear';
          btn.disabled = false;
        } else {
          alert('Error: ' + (result.error || 'Unknown error'));
          btn.textContent = 'Clear';
          btn.disabled = false;
        }
      })
      .catch(err => {
        alert('Error: ' + err.message);
        btn.textContent = 'Clear';
        btn.disabled = false;
      });
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
