/**
 * User management admin page.
 *
 * Shows all admin users with options to:
 *  - Create a new user (username, email, password, role, display name)
 *  - Edit a user's role, name, email, or enabled state
 *  - Change a user's password
 *  - Delete a user (cannot delete your own account)
 */

import type { AdminUserInfo } from "../types.ts";

export interface UsersPageData {
  users: AdminUserInfo[];
  /** The currently logged-in user's ID — cannot be deleted by the UI */
  currentUserId: string;
  /** Whether the current user has admin role (non-admins can't change roles) */
  isAdmin: boolean;
}

/**
 * Render the Users admin page.
 */
export function renderUsersPage(prefix: string, data: UsersPageData): string {
  const rows = data.users
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((u) => {
      const isSelf = u.id === data.currentUserId;
      const roleLabel = u.role.charAt(0).toUpperCase() + u.role.slice(1);
      const enabledToggle = `<button class="btn btn-xs ${u.enabled ? "btn-enabled" : "btn-disabled"}"
          onclick="toggleEnabled('${escapeAttr(u.id)}', ${!u.enabled})"
          title="${u.enabled ? "Disable user" : "Enable user"}">${u.enabled ? "Active" : "Disabled"}</button>`;

      const actions = `
        <button class="btn btn-xs btn-outline" onclick="openEditUser('${escapeAttr(u.id)}', '${escapeAttr(u.name)}', '${escapeAttr(u.email)}', '${escapeAttr(u.role)}')">Edit</button>
        <button class="btn btn-xs btn-outline" onclick="openPassword('${escapeAttr(u.id)}')">Password</button>
        ${!isSelf ? `<button class="btn btn-xs btn-danger" onclick="deleteUser('${escapeAttr(u.id)}', '${escapeAttr(u.username)}')">Delete</button>` : `<span class="user-self-badge">you</span>`}
      `;

      return `
      <tr>
        <td><strong>${escapeHtml(u.name || u.username)}</strong><br><span class="user-username">@${escapeHtml(u.username)}</span></td>
        <td class="user-email">${escapeHtml(u.email)}</td>
        <td><span class="role-badge role-${escapeAttr(u.role)}">${escapeHtml(roleLabel)}</span></td>
        <td>${enabledToggle}</td>
        <td class="user-actions">${actions}</td>
      </tr>`;
    }).join("");

  return `
  <div class="users-toolbar">
    ${data.isAdmin ? `<button class="btn btn-primary" onclick="openCreateUser()">+ New User</button>` : ""}
    <span class="user-count">${data.users.length} ${data.users.length === 1 ? "user" : "users"}</span>
  </div>

  <table class="admin-table users-table">
    <thead>
      <tr>
        <th>Name / Username</th>
        <th>Email</th>
        <th>Role</th>
        <th>Status</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="5" class="users-empty">No users found.</td></tr>'}
    </tbody>
  </table>

  <!-- Create User Modal -->
  <div id="create-modal" class="modal" style="display:none">
    <div class="modal-backdrop" onclick="closeModals()"></div>
    <div class="modal-content">
      <h3>New User</h3>
      <div class="form-group">
        <label>Username <span class="required-mark">*</span></label>
        <input type="text" id="new-username" placeholder="e.g. jane" autocomplete="off">
      </div>
      <div class="form-group">
        <label>Display Name</label>
        <input type="text" id="new-name" placeholder="e.g. Jane Doe">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="new-email" placeholder="jane@example.com">
      </div>
      <div class="form-group">
        <label>Password <span class="required-mark">*</span></label>
        <input type="password" id="new-password" placeholder="Minimum 12 characters" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label>Role <span class="required-mark">*</span></label>
        <select id="new-role">
          <option value="author">Author — can create and edit own pages</option>
          <option value="editor">Editor — can create, edit, and manage media</option>
          ${data.isAdmin ? '<option value="admin">Admin — full access</option>' : ""}
        </select>
      </div>
      <div id="create-error" class="alert alert-error" style="display:none"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModals()">Cancel</button>
        <button class="btn btn-primary" id="create-btn" onclick="createUser()">Create User</button>
      </div>
    </div>
  </div>

  <!-- Edit User Modal -->
  <div id="edit-modal" class="modal" style="display:none">
    <div class="modal-backdrop" onclick="closeModals()"></div>
    <div class="modal-content">
      <h3>Edit User</h3>
      <input type="hidden" id="edit-user-id">
      <div class="form-group">
        <label>Display Name</label>
        <input type="text" id="edit-name" placeholder="Display name">
      </div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="edit-email" placeholder="user@example.com">
      </div>
      ${data.isAdmin ? `
      <div class="form-group">
        <label>Role</label>
        <select id="edit-role">
          <option value="author">Author</option>
          <option value="editor">Editor</option>
          <option value="admin">Admin</option>
        </select>
      </div>` : ""}
      <div id="edit-error" class="alert alert-error" style="display:none"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModals()">Cancel</button>
        <button class="btn btn-primary" id="edit-btn" onclick="saveEditUser()">Save Changes</button>
      </div>
    </div>
  </div>

  <!-- Change Password Modal -->
  <div id="password-modal" class="modal" style="display:none">
    <div class="modal-backdrop" onclick="closeModals()"></div>
    <div class="modal-content">
      <h3>Change Password</h3>
      <input type="hidden" id="pw-user-id">
      <div class="form-group">
        <label>New Password <span class="required-mark">*</span></label>
        <input type="password" id="pw-new" placeholder="Minimum 12 characters" autocomplete="new-password">
      </div>
      <div class="form-group">
        <label>Confirm Password <span class="required-mark">*</span></label>
        <input type="password" id="pw-confirm" placeholder="Repeat password" autocomplete="new-password">
      </div>
      <div id="pw-error" class="alert alert-error" style="display:none"></div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="closeModals()">Cancel</button>
        <button class="btn btn-primary" id="pw-btn" onclick="changePassword()">Change Password</button>
      </div>
    </div>
  </div>

  <script>${usersScript(prefix)}</script>
  `;
}

function usersScript(prefix: string): string {
  return `
    function closeModals() {
      document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    }

    function openCreateUser() {
      document.getElementById('new-username').value = '';
      document.getElementById('new-name').value = '';
      document.getElementById('new-email').value = '';
      document.getElementById('new-password').value = '';
      document.getElementById('create-error').style.display = 'none';
      document.getElementById('create-modal').style.display = 'flex';
      document.getElementById('new-username').focus();
    }

    function openEditUser(id, name, email, role) {
      document.getElementById('edit-user-id').value = id;
      document.getElementById('edit-name').value = name;
      document.getElementById('edit-email').value = email;
      const roleSelect = document.getElementById('edit-role');
      if (roleSelect) roleSelect.value = role;
      document.getElementById('edit-error').style.display = 'none';
      document.getElementById('edit-modal').style.display = 'flex';
      document.getElementById('edit-name').focus();
    }

    function openPassword(id) {
      document.getElementById('pw-user-id').value = id;
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
      document.getElementById('pw-error').style.display = 'none';
      document.getElementById('password-modal').style.display = 'flex';
      document.getElementById('pw-new').focus();
    }

    function showError(id, msg) {
      const el = document.getElementById(id);
      el.textContent = msg;
      el.style.display = 'block';
    }

    function setLoading(btnId, loading, originalText) {
      const btn = document.getElementById(btnId);
      btn.disabled = loading;
      btn.textContent = loading ? 'Saving…' : originalText;
    }

    function createUser() {
      const username = document.getElementById('new-username').value.trim();
      const name = document.getElementById('new-name').value.trim();
      const email = document.getElementById('new-email').value.trim();
      const password = document.getElementById('new-password').value;
      const role = document.getElementById('new-role').value;

      if (!username) { showError('create-error', 'Username is required.'); return; }
      if (password.length < 12) { showError('create-error', 'Password must be at least 12 characters.'); return; }

      setLoading('create-btn', true, 'Create User');
      fetch('${prefix}/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, name, email, password, role }),
      })
      .then(r => r.json())
      .then(res => {
        if (res.created) { location.reload(); }
        else { showError('create-error', res.error || 'Unknown error'); setLoading('create-btn', false, 'Create User'); }
      })
      .catch(err => { showError('create-error', err.message); setLoading('create-btn', false, 'Create User'); });
    }

    function saveEditUser() {
      const id = document.getElementById('edit-user-id').value;
      const name = document.getElementById('edit-name').value.trim();
      const email = document.getElementById('edit-email').value.trim();
      const roleEl = document.getElementById('edit-role');
      const role = roleEl ? roleEl.value : undefined;
      const body = { name, email };
      if (role) body.role = role;

      setLoading('edit-btn', true, 'Save Changes');
      fetch('${prefix}/api/users/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      .then(r => r.json())
      .then(res => {
        if (res.ok) { location.reload(); }
        else { showError('edit-error', res.error || 'Unknown error'); setLoading('edit-btn', false, 'Save Changes'); }
      })
      .catch(err => { showError('edit-error', err.message); setLoading('edit-btn', false, 'Save Changes'); });
    }

    function changePassword() {
      const id = document.getElementById('pw-user-id').value;
      const newPw = document.getElementById('pw-new').value;
      const confirm = document.getElementById('pw-confirm').value;
      if (newPw.length < 12) { showError('pw-error', 'Password must be at least 12 characters.'); return; }
      if (newPw !== confirm) { showError('pw-error', 'Passwords do not match.'); return; }

      setLoading('pw-btn', true, 'Change Password');
      fetch('${prefix}/api/users/' + id + '/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPw }),
      })
      .then(r => r.json())
      .then(res => {
        if (res.ok) { closeModals(); alert('Password changed successfully.'); }
        else { showError('pw-error', res.error || 'Unknown error'); setLoading('pw-btn', false, 'Change Password'); }
      })
      .catch(err => { showError('pw-error', err.message); setLoading('pw-btn', false, 'Change Password'); });
    }

    function toggleEnabled(id, enable) {
      fetch('${prefix}/api/users/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable }),
      })
      .then(r => r.json())
      .then(res => {
        if (res.ok) { location.reload(); }
        else { alert('Error: ' + (res.error || 'Unknown')); }
      })
      .catch(err => alert('Error: ' + err.message));
    }

    function deleteUser(id, username) {
      if (!confirm('Delete user @' + username + '? This cannot be undone.')) return;
      fetch('${prefix}/api/users/' + id, { method: 'DELETE' })
      .then(r => r.json())
      .then(res => {
        if (res.ok) { location.reload(); }
        else { alert('Error: ' + (res.error || 'Unknown')); }
      })
      .catch(err => alert('Error: ' + err.message));
    }
  `;
}

/**
 * CSS for the users page.
 */
export function userStyles(): string {
  return `
  .users-toolbar { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1rem; }
  .user-count { font-size: 0.85rem; color: #6b7280; }
  .users-table { table-layout: fixed; }
  .users-table td { vertical-align: middle; padding: 0.6rem 0.75rem; }
  .user-username { font-size: 0.75rem; color: #9ca3af; }
  .user-email { font-size: 0.83rem; color: #555; word-break: break-all; }
  .user-actions { display: flex; gap: 0.3rem; align-items: center; flex-wrap: wrap; }
  .user-self-badge { font-size: 0.7rem; color: #9ca3af; font-style: italic; }
  .users-empty { text-align: center; padding: 2rem; color: #9ca3af; }
  .role-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.72rem; font-weight: 600; }
  .role-admin { background: #fef3c7; color: #92400e; }
  .role-editor { background: #dbeafe; color: #1e40af; }
  .role-author { background: #d1fae5; color: #065f46; }
  .btn-enabled { background: #d1fae5; color: #065f46; border: 1px solid #a7f3d0; }
  .btn-enabled:hover { background: #a7f3d0; }
  .btn-disabled { background: #f3f4f6; color: #9ca3af; border: 1px solid #e5e7eb; }
  .btn-disabled:hover { background: #e5e7eb; }
  .btn-danger { background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; }
  .btn-danger:hover { background: #fca5a5; }
  /* Modals */
  .modal { display: none; position: fixed; inset: 0; align-items: center; justify-content: center; z-index: 200; }
  .modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.45); }
  .modal-content { position: relative; background: #fff; border-radius: 10px; padding: 1.5rem; width: 100%; max-width: 440px; margin: 1rem; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
  .modal-content h3 { margin-bottom: 1rem; font-size: 1.1rem; color: #1a1a2e; }
  .modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
  .required-mark { color: #ef4444; }
  .alert { padding: 0.6rem 0.85rem; border-radius: 5px; font-size: 0.85rem; margin-bottom: 0.5rem; }
  .alert-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
  `;
}

function escapeHtml(str: string): string {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return (str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
