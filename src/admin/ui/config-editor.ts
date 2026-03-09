/**
 * Admin UI — Configuration editor.
 *
 * Renders a tabbed form for editing config/site.yaml and config/system.yaml.
 * The editor only surfaces the fields most commonly changed by site owners;
 * advanced keys (theme.custom, routes, redirects, plugins, etc.) are preserved
 * on save via a read-merge-write pattern so nothing is silently dropped.
 */

import type { DuneConfig } from "../../config/types.ts";
import type { BlueprintField } from "../../blueprints/types.ts";

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(
    /"/g,
    "&quot;",
  );
}

function escapeAttr(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Data required for theme UI in the config editor. */
export interface ConfigEditorThemeData {
  availableThemes: string[];
  currentTheme: string;
  themeSchema: Record<string, BlueprintField>;
  themeConfig: Record<string, unknown>;
  /** Top-level nav routes for the preview route picker. */
  navRoutes: Array<{ route: string; title: string }>;
}

/** Render the full config editor page (shell not included — caller wraps it). */
export function renderConfigEditor(
  prefix: string,
  cfg: DuneConfig,
  themeData?: ConfigEditorThemeData,
): string {
  const { site, system } = cfg;

  // Pre-serialize list state for JS init
  const initState = {
    taxonomies: site.taxonomies ?? [],
    corsOrigins: site.cors_origins ?? [],
    supportedLangs: system.languages.supported,
    allowedSizes: system.images.allowed_sizes.map(String),
  };

  const siteHome = site.home ?? "";
  const authorEmail = site.author.email ?? "";

  // Cache / language / image options
  const cacheDrivers = ["memory", "filesystem", "kv"];
  const cacheChecks = ["file", "hash", "none"];

  function cacheDriverOpts(current: string) {
    return cacheDrivers
      .map((d) => `<option value="${d}"${current === d ? " selected" : ""}>${d}</option>`)
      .join("");
  }
  function cacheCheckOpts(current: string) {
    return cacheChecks
      .map((c) => `<option value="${c}"${current === c ? " selected" : ""}>${c}</option>`)
      .join("");
  }

  return `
<div class="cfg-header">
  <h2>Configuration</h2>
  <div class="cfg-actions">
    <span id="cfg-status" class="cfg-status"></span>
    <button class="btn btn-primary btn-sm" onclick="saveConfig()">Save changes</button>
  </div>
</div>

<div id="cfg-notice" class="cfg-notice" style="display:none"></div>

<div class="cfg-tabs" role="tablist">
  <button class="cfg-tab active" role="tab" onclick="switchTab('site',this)">Site</button>
  <button class="cfg-tab" role="tab" onclick="switchTab('system',this)">System</button>
  <button class="cfg-tab" role="tab" onclick="switchTab('theme',this)">Theme</button>
</div>

<!-- ── Site tab ── -->
<div class="cfg-section" id="tab-site">

  <div class="cfg-group">
    <h3>Identity</h3>
    <div class="form-row-2">
      <div class="form-group">
        <label for="site-title">Site title <span class="required-mark">*</span></label>
        <input type="text" id="site-title" value="${escapeAttr(site.title)}" oninput="markDirty()">
      </div>
      <div class="form-group">
        <label for="site-url">Site URL <span class="required-mark">*</span></label>
        <input type="text" id="site-url" value="${escapeAttr(site.url)}" placeholder="https://example.com" oninput="markDirty()">
      </div>
    </div>
    <div class="form-group">
      <label for="site-description">Description</label>
      <textarea id="site-description" rows="2" oninput="markDirty()">${escapeHtml(site.description)}</textarea>
    </div>
    <div class="form-group" style="max-width:260px">
      <label for="site-home">Homepage slug <small class="cfg-optional">(blank = auto-detect)</small></label>
      <input type="text" id="site-home" value="${escapeAttr(siteHome)}" placeholder="e.g. home" oninput="markDirty()">
    </div>
  </div>

  <div class="cfg-group">
    <h3>Author</h3>
    <div class="form-row-2">
      <div class="form-group">
        <label for="site-author-name">Name <span class="required-mark">*</span></label>
        <input type="text" id="site-author-name" value="${escapeAttr(site.author.name)}" oninput="markDirty()">
      </div>
      <div class="form-group">
        <label for="site-author-email">Email <small class="cfg-optional">optional</small></label>
        <input type="email" id="site-author-email" value="${escapeAttr(authorEmail)}" oninput="markDirty()">
      </div>
    </div>
  </div>

  <div class="cfg-group">
    <h3>Taxonomies</h3>
    <p class="cfg-hint">Names of taxonomy dimensions used across content (e.g. tag, category).</p>
    <div class="tag-input-wrapper" id="taxonomies-wrapper">
      <div class="tag-chips" id="taxonomies-chips"></div>
      <input type="text" class="tag-input" id="taxonomies-input"
             placeholder="Add taxonomy…" autocomplete="off"
             onkeydown="handleListKey(event,'taxonomies')">
    </div>
  </div>

  <div class="cfg-group">
    <h3>CORS origins <small class="cfg-optional">optional</small></h3>
    <p class="cfg-hint">Extra origins allowed to call the REST API. Your site URL is always included.</p>
    <div class="tag-input-wrapper" id="corsOrigins-wrapper">
      <div class="tag-chips" id="corsOrigins-chips"></div>
      <input type="text" class="tag-input" id="corsOrigins-input"
             placeholder="https://other-site.com" autocomplete="off"
             onkeydown="handleListKey(event,'corsOrigins')">
    </div>
  </div>

</div><!-- /tab-site -->

<!-- ── System tab ── -->
<div class="cfg-section" id="tab-system" style="display:none">

  <div class="cfg-group">
    <h3>Content</h3>
    <div class="form-group" style="max-width:260px">
      <label for="system-content-dir">Content directory</label>
      <input type="text" id="system-content-dir" value="${escapeAttr(system.content.dir)}" oninput="markDirty()">
    </div>
  </div>

  <div class="cfg-group">
    <h3>Cache</h3>
    <div class="form-row-auto">
      <div class="form-group">
        <label class="toggle-label">
          <input type="checkbox" id="system-cache-enabled"${system.cache.enabled ? " checked" : ""} onchange="markDirty()">
          Enable caching
        </label>
      </div>
      <div class="form-group">
        <label for="system-cache-driver">Backend</label>
        <select id="system-cache-driver" onchange="markDirty()">${cacheDriverOpts(system.cache.driver)}</select>
      </div>
      <div class="form-group">
        <label for="system-cache-lifetime">Lifetime (s)</label>
        <input type="number" id="system-cache-lifetime" value="${system.cache.lifetime}" min="0" style="width:110px" oninput="markDirty()">
      </div>
      <div class="form-group">
        <label for="system-cache-check">Invalidation</label>
        <select id="system-cache-check" onchange="markDirty()">${cacheCheckOpts(system.cache.check)}</select>
      </div>
    </div>
  </div>

  <div class="cfg-group">
    <h3>Images</h3>
    <div class="form-group">
      <label for="system-images-quality">
        Default JPEG quality: <strong id="system-images-quality-val">${system.images.default_quality}</strong>
      </label>
      <input type="range" id="system-images-quality" class="cfg-range"
             min="1" max="100" value="${system.images.default_quality}"
             oninput="document.getElementById('system-images-quality-val').textContent=this.value;markDirty()">
    </div>
    <div class="form-group">
      <label>Allowed resize widths (px)</label>
      <p class="cfg-hint">Only these pixel widths are accepted by the image processor.</p>
      <div class="tag-input-wrapper" id="allowedSizes-wrapper">
        <div class="tag-chips" id="allowedSizes-chips"></div>
        <input type="number" class="tag-input" id="allowedSizes-input"
               placeholder="e.g. 1920" min="1" max="8192" style="width:100px"
               onkeydown="handleSizeKey(event)">
      </div>
    </div>
  </div>

  <div class="cfg-group">
    <h3>Languages</h3>
    <div class="form-group">
      <label>Supported language codes</label>
      <div class="tag-input-wrapper" id="supportedLangs-wrapper">
        <div class="tag-chips" id="supportedLangs-chips"></div>
        <input type="text" class="tag-input" id="supportedLangs-input"
               placeholder="e.g. en" autocomplete="off"
               onkeydown="handleListKey(event,'supportedLangs')">
      </div>
    </div>
    <div class="form-row-auto">
      <div class="form-group" style="max-width:160px">
        <label for="system-lang-default">Default language</label>
        <input type="text" id="system-lang-default" value="${escapeAttr(system.languages.default)}" oninput="markDirty()">
      </div>
      <div class="form-group" style="align-self:flex-end">
        <label class="toggle-label">
          <input type="checkbox" id="system-lang-include-default"${system.languages.include_default_in_url ? " checked" : ""} onchange="markDirty()">
          Include default language in URL
        </label>
      </div>
    </div>
  </div>

  <div class="cfg-group">
    <h3>Miscellaneous</h3>
    <div class="form-row-auto">
      <div class="form-group" style="max-width:220px">
        <label for="system-timezone">Timezone</label>
        <input type="text" id="system-timezone" value="${escapeAttr(system.timezone)}" placeholder="UTC" oninput="markDirty()">
      </div>
      <div class="form-group" style="align-self:flex-end">
        <label class="toggle-label">
          <input type="checkbox" id="system-debug"${system.debug ? " checked" : ""} onchange="markDirty()">
          Debug mode
        </label>
      </div>
    </div>
  </div>

</div><!-- /tab-system -->

<!-- ── Theme tab ── -->
<div class="cfg-section" id="tab-theme" style="display:none">

  <div class="cfg-group">
    <h3>Active Theme</h3>
    <div class="form-row-auto" style="align-items:flex-end">
      <div class="form-group">
        <label for="theme-select">Theme</label>
        <select id="theme-select" onchange="markThemeDirty()">
          ${(themeData?.availableThemes ?? []).map((t) =>
            `<option value="${escapeAttr(t)}"${t === (themeData?.currentTheme ?? "") ? " selected" : ""}>${escapeHtml(t)}</option>`
          ).join("")}
        </select>
      </div>
      <div class="form-group" style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" onclick="switchTheme()" id="theme-switch-btn">Switch theme</button>
        <button class="btn btn-secondary btn-sm" onclick="openThemePreview()">Preview</button>
        <span id="theme-switch-status" class="cfg-status"></span>
      </div>
    </div>
  </div>

  <!-- ── Theme preview panel ── -->
  <div id="theme-preview-panel" class="theme-preview-panel" style="display:none">
    <div class="theme-preview-toolbar">
      <label for="preview-route-select">Route</label>
      <select id="preview-route-select" onchange="refreshThemePreview()">
        <option value="/">/ (home)</option>
        ${(themeData?.navRoutes ?? []).map((r) =>
          `<option value="${escapeAttr(r.route)}">${escapeHtml(r.title)} (${escapeAttr(r.route)})</option>`
        ).join("")}
      </select>
      <input type="text" id="preview-route-input" placeholder="or type a path…"
             style="width:150px" oninput="refreshThemePreview()">
      <button class="btn btn-secondary btn-sm" onclick="refreshThemePreview()">↻ Refresh</button>
      <button class="btn btn-primary btn-sm" onclick="applyPreviewTheme()">Apply this theme</button>
      <button class="btn btn-secondary btn-sm" onclick="closeThemePreview()"
              style="margin-left:auto">× Close</button>
    </div>
    <iframe id="theme-preview-frame" class="theme-preview-frame" src="about:blank"
            title="Theme preview"></iframe>
  </div>

  ${themeData && Object.keys(themeData.themeSchema).length > 0 ? `
  <div class="cfg-group">
    <h3>Theme Settings</h3>
    <p class="cfg-hint">These settings are defined by the active theme.</p>
    <div id="theme-config-fields">
      ${renderThemeConfigFields(themeData.themeSchema, themeData.themeConfig)}
    </div>
    <div class="form-group" style="margin-top:1rem">
      <button class="btn btn-primary btn-sm" onclick="saveThemeConfig()">Save theme settings</button>
      <span id="theme-config-status" class="cfg-status"></span>
    </div>
  </div>` : ""}

  <div class="cfg-group" style="padding:0.75rem 1.5rem">
    <a href="${prefix}/themes" class="theme-browse-link">🎨 Browse more themes →</a>
  </div>

</div><!-- /tab-theme -->

<script>
${configEditorScript(prefix, initState, themeData)}
</script>
`;
}

/**
 * Render blueprint-driven config fields for the active theme's configSchema.
 * Mirrors the pattern from plugins.ts `renderConfigFields()`.
 */
function renderThemeConfigFields(
  schema: Record<string, BlueprintField>,
  current: Record<string, unknown>,
): string {
  return Object.entries(schema).map(([key, field]) => {
    const value = current[key] ?? field.default ?? "";
    const id = `theme-cfg-${escapeAttr(key)}`;

    let input: string;
    if (field.type === "toggle") {
      const checked = value === true ? "checked" : "";
      input = `<input type="checkbox" id="${id}" name="${escapeAttr(key)}" data-tcfg="${escapeAttr(key)}" data-type="toggle" ${checked}>`;
    } else if (field.type === "select" && field.options) {
      const opts = Object.entries(field.options)
        .map(([v, label]) =>
          `<option value="${escapeAttr(v)}"${value === v ? " selected" : ""}>${escapeHtml(label)}</option>`,
        )
        .join("");
      input = `<select id="${id}" name="${escapeAttr(key)}" data-tcfg="${escapeAttr(key)}">${opts}</select>`;
    } else if (field.type === "textarea" || field.type === "markdown") {
      input = `<textarea id="${id}" name="${escapeAttr(key)}" data-tcfg="${escapeAttr(key)}" rows="4">${escapeHtml(String(value))}</textarea>`;
    } else if (field.type === "number") {
      const min = field.validate?.min !== undefined ? `min="${field.validate.min}"` : "";
      const max = field.validate?.max !== undefined ? `max="${field.validate.max}"` : "";
      input = `<input type="number" id="${id}" name="${escapeAttr(key)}" data-tcfg="${escapeAttr(key)}" value="${escapeAttr(String(value))}" ${min} ${max}>`;
    } else if (field.type === "color") {
      input = `<input type="color" id="${id}" name="${escapeAttr(key)}" data-tcfg="${escapeAttr(key)}" value="${escapeAttr(String(value))}">`;
    } else if (field.type === "date") {
      input = `<input type="date" id="${id}" name="${escapeAttr(key)}" data-tcfg="${escapeAttr(key)}" value="${escapeAttr(String(value))}">`;
    } else {
      input = `<input type="text" id="${id}" name="${escapeAttr(key)}" data-tcfg="${escapeAttr(key)}" value="${escapeAttr(String(value))}">`;
    }

    const required = field.required ? ' <span style="color:#c00">*</span>' : "";
    return `<div class="form-group">
      <label for="${id}">${escapeHtml(field.label)}${required}</label>
      ${input}
    </div>`;
  }).join("\n");
}

function configEditorScript(
  prefix: string,
  initState: {
    taxonomies: string[];
    corsOrigins: string[];
    supportedLangs: string[];
    allowedSizes: string[];
  },
  themeData?: ConfigEditorThemeData,
): string {
  return `
  // ── State ──────────────────────────────────────────────────────────────────
  const listState = ${JSON.stringify(initState)};
  let isDirty = false;

  // ── Tab switching ──────────────────────────────────────────────────────────
  function switchTab(name, btn) {
    document.querySelectorAll('.cfg-section').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.cfg-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('tab-' + name).style.display = '';
    if (btn) btn.classList.add('active');
  }

  // ── Dirty tracking ─────────────────────────────────────────────────────────
  function markDirty() {
    isDirty = true;
    document.getElementById('cfg-status').textContent = 'Unsaved changes';
  }

  // ── Generic list (chip) helpers ────────────────────────────────────────────
  function renderListChips(key) {
    const chips = document.getElementById(key + '-chips');
    if (!chips) return;
    chips.innerHTML = (listState[key] || []).map(val =>
      '<span class="tag-chip">' + escapeHtml(String(val)) +
      ' <button class="tag-chip-remove" onclick="removeListItem(' + JSON.stringify(key) + ',' + JSON.stringify(val) + ')" title="Remove">×</button>' +
      '</span>'
    ).join('');
  }

  function addListItem(key, value) {
    value = String(value).trim();
    if (!value) return;
    if (!listState[key]) listState[key] = [];
    if (!listState[key].includes(value)) {
      listState[key].push(value);
      renderListChips(key);
      markDirty();
    }
    const input = document.getElementById(key + '-input');
    if (input) input.value = '';
  }

  function removeListItem(key, value) {
    if (!listState[key]) return;
    const idx = listState[key].indexOf(value);
    if (idx !== -1) { listState[key].splice(idx, 1); renderListChips(key); markDirty(); }
  }

  function handleListKey(event, key) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addListItem(key, event.target.value.replace(/,\\s*$/, ''));
    }
  }

  function handleSizeKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const v = parseInt(event.target.value, 10);
      if (v > 0) addListItem('allowedSizes', String(v));
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Collect payload ────────────────────────────────────────────────────────
  function getVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function getBool(id) { const el = document.getElementById(id); return el ? el.checked : false; }
  function getNum(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const n = parseFloat(el.value);
    return isNaN(n) ? fallback : n;
  }

  function collectPayload() {
    return {
      site: {
        title: getVal('site-title').trim(),
        description: getVal('site-description').trim(),
        url: getVal('site-url').trim(),
        home: getVal('site-home').trim() || undefined,
        author: {
          name: getVal('site-author-name').trim(),
          email: getVal('site-author-email').trim() || undefined,
        },
        taxonomies: listState.taxonomies.slice(),
        cors_origins: listState.corsOrigins.length ? listState.corsOrigins.slice() : undefined,
      },
      system: {
        content: { dir: getVal('system-content-dir').trim() },
        cache: {
          enabled: getBool('system-cache-enabled'),
          driver: getVal('system-cache-driver'),
          lifetime: getNum('system-cache-lifetime', 3600),
          check: getVal('system-cache-check'),
        },
        images: {
          default_quality: getNum('system-images-quality', 80),
          allowed_sizes: listState.allowedSizes.map(Number).filter(n => n > 0),
        },
        languages: {
          supported: listState.supportedLangs.slice(),
          default: getVal('system-lang-default').trim(),
          include_default_in_url: getBool('system-lang-include-default'),
        },
        debug: getBool('system-debug'),
        timezone: getVal('system-timezone').trim() || 'UTC',
      },
    };
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  async function saveConfig() {
    const btn = document.querySelector('[onclick="saveConfig()"]');
    if (btn) btn.disabled = true;
    hideNotice();

    try {
      const payload = collectPayload();
      const resp = await fetch('${prefix}/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();

      if (result.updated) {
        isDirty = false;
        document.getElementById('cfg-status').textContent = 'Saved';
        if (result.restartRequired) {
          showNotice('warning', '✓ Configuration saved. Some changes (cache, content directory, languages) take effect after a server restart.');
        } else {
          showNotice('success', '✓ Configuration saved successfully.');
        }
      } else if (result.validationErrors && result.validationErrors.length) {
        showNotice('error', '<strong>Validation errors:</strong><ul>' +
          result.validationErrors.map(e => '<li>' + escapeHtml(e) + '</li>').join('') +
          '</ul>');
      } else {
        showNotice('error', 'Save failed: ' + escapeHtml(result.error || 'Unknown error'));
      }
    } catch (err) {
      showNotice('error', 'Save error: ' + escapeHtml(err.message));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Notice banner ──────────────────────────────────────────────────────────
  function showNotice(type, html) {
    const el = document.getElementById('cfg-notice');
    el.className = 'cfg-notice cfg-notice-' + type;
    el.innerHTML = html;
    el.style.display = '';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function hideNotice() {
    const el = document.getElementById('cfg-notice');
    el.style.display = 'none';
    el.innerHTML = '';
  }

  // ── Theme selector ─────────────────────────────────────────────────────────
  let themeSwitchDirty = false;
  function markThemeDirty() { themeSwitchDirty = true; }

  async function switchTheme() {
    const sel = document.getElementById('theme-select');
    if (!sel) return;
    const name = sel.value;
    const btn = document.getElementById('theme-switch-btn');
    const status = document.getElementById('theme-switch-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Switching…';
    try {
      const resp = await fetch('${prefix}/api/config/theme', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const result = await resp.json();
      if (result.switched) {
        if (status) status.textContent = '✓ Theme switched — page will reload';
        setTimeout(() => location.reload(), 1200);
      } else {
        if (status) status.textContent = '✗ ' + escapeHtml(result.error || 'Error');
      }
    } catch (err) {
      if (status) status.textContent = '✗ Network error';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Theme preview ──────────────────────────────────────────────────────────
  function openThemePreview() {
    const panel = document.getElementById('theme-preview-panel');
    if (!panel) return;
    panel.style.display = 'block';
    refreshThemePreview();
  }

  function closeThemePreview() {
    const panel = document.getElementById('theme-preview-panel');
    if (panel) panel.style.display = 'none';
  }

  function refreshThemePreview() {
    const theme = (document.getElementById('theme-select') || {}).value;
    if (!theme) return;
    const routeInput = (document.getElementById('preview-route-input') || {}).value || '';
    const routeSelect = (document.getElementById('preview-route-select') || {}).value || '/';
    const route = routeInput.trim() || routeSelect;
    const frame = document.getElementById('theme-preview-frame');
    if (frame) {
      frame.src = '${prefix}/api/theme-preview?theme=' + encodeURIComponent(theme) +
                  '&route=' + encodeURIComponent(route);
    }
  }

  function applyPreviewTheme() {
    closeThemePreview();
    switchTheme();
  }

  // ── Theme config save ──────────────────────────────────────────────────────
  async function saveThemeConfig() {
    const fields = document.querySelectorAll('[data-tcfg]');
    const cfg = {};
    fields.forEach(el => {
      const key = el.dataset.tcfg;
      if (el.dataset.type === 'toggle') {
        cfg[key] = el.checked;
      } else {
        cfg[key] = el.value;
      }
    });
    const status = document.getElementById('theme-config-status');
    if (status) status.textContent = 'Saving…';
    try {
      const resp = await fetch('${prefix}/api/config/theme-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const result = await resp.json();
      if (status) status.textContent = result.saved ? '✓ Saved' : '✗ ' + escapeHtml(result.error || 'Error');
      setTimeout(() => { if (status) status.textContent = ''; }, 3000);
    } catch {
      if (status) status.textContent = '✗ Network error';
    }
  }

  // ── Warn on unsaved leave ──────────────────────────────────────────────────
  window.addEventListener('beforeunload', function(e) {
    if (isDirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  (function init() {
    ['taxonomies','corsOrigins','supportedLangs','allowedSizes'].forEach(renderListChips);

    // Handle ?preview_theme=X and ?switch_theme=X query params (from themes page buttons)
    const qp = new URLSearchParams(location.search);
    const previewTheme = qp.get('preview_theme');
    const switchThemeQP = qp.get('switch_theme');
    const themeQP = previewTheme || switchThemeQP;
    if (themeQP) {
      // Activate theme tab
      document.querySelectorAll('.cfg-section').forEach(s => s.style.display = 'none');
      document.querySelectorAll('.cfg-tab').forEach(t => {
        t.classList.remove('active');
        if (t.textContent && t.textContent.trim() === 'Theme') t.classList.add('active');
      });
      const themeSection = document.getElementById('tab-theme');
      if (themeSection) themeSection.style.display = '';
      // Pre-select the theme
      const sel = document.getElementById('theme-select');
      if (sel) sel.value = themeQP;
      // Auto-open preview if requested
      if (previewTheme) openThemePreview();
    }
  })();
  `;
}

export function configEditorStyles(): string {
  return `
  .cfg-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
  .cfg-header h2 { margin: 0; flex: 1; }
  .cfg-actions { display: flex; align-items: center; gap: 0.75rem; }
  .cfg-status { font-size: 0.82rem; color: #888; }
  .cfg-tabs { display: flex; gap: 0; border-bottom: 2px solid #e5e7eb; margin-bottom: 1.5rem; }
  .cfg-tab { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -2px; padding: 0.5rem 1.25rem; font-size: 0.9rem; cursor: pointer; color: #555; }
  .cfg-tab.active { color: #c9a96e; border-bottom-color: #c9a96e; font-weight: 600; }
  .cfg-tab:hover:not(.active) { color: #333; }
  .cfg-section { max-width: 860px; }
  .cfg-group { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 1.25rem 1.5rem; margin-bottom: 1.25rem; }
  .cfg-group h3 { margin: 0 0 1rem; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #666; }
  .cfg-hint { font-size: 0.82rem; color: #888; margin: -0.25rem 0 0.75rem; }
  .cfg-optional { font-weight: 400; color: #999; font-size: 0.8rem; }
  .cfg-range { width: 100%; max-width: 320px; }
  .cfg-notice { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.875rem; line-height: 1.5; }
  .cfg-notice ul { margin: 0.25rem 0 0 1rem; padding: 0; }
  .cfg-notice-success { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
  .cfg-notice-warning { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
  .cfg-notice-error   { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
  .form-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .form-row-auto { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-start; }
  @media (max-width: 600px) { .form-row-2 { grid-template-columns: 1fr; } }
  .theme-preview-panel { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-top: 1.25rem; max-width: 860px; }
  .theme-preview-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; padding: 0.65rem 1rem; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
  .theme-preview-toolbar label { font-size: 0.82rem; color: #666; white-space: nowrap; }
  .theme-preview-toolbar select { font-size: 0.82rem; padding: 0.25rem 0.5rem; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; max-width: 240px; }
  .theme-preview-toolbar input[type="text"] { font-size: 0.82rem; padding: 0.25rem 0.5rem; border: 1px solid #d1d5db; border-radius: 4px; }
  .theme-preview-frame { display: block; width: 100%; height: 600px; border: none; background: #f5f5f5; }
  .theme-browse-link { font-size: 0.875rem; color: #c9a96e; text-decoration: none; font-weight: 500; }
  .theme-browse-link:hover { text-decoration: underline; }
  `;
}
