/** @jsxImportSource preact */
/**
 * Island: user list with create, edit (name/email/role/enabled), password change,
 * and delete. Talks to /admin/api/users and /admin/api/users/:id.
 */

import { h, Fragment } from "preact";
import { useState, useEffect } from "preact/hooks";

interface AdminUser {
  id: string;
  username: string;
  name: string;
  email: string;
  role: string;
  enabled: boolean;
  createdAt: number;
}

interface Props {
  prefix: string;
}

type Modal =
  | { kind: "create" }
  | { kind: "edit"; user: AdminUser }
  | { kind: "password"; userId: string; username: string }
  | null;

export default function UserManager({ prefix }: Props) {
  const apiBase = `${prefix}/api`;

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [error, setError] = useState("");

  // Form fields
  const [fUsername, setFUsername] = useState("");
  const [fName, setFName] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fRole, setFRole] = useState("editor");
  const [fPassword, setFPassword] = useState("");
  const [fEnabled, setFEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/users`);
      const d = await res.json() as { users: AdminUser[]; currentUserId: string; isAdmin: boolean };
      setUsers(d.users ?? []);
      setCurrentUserId(d.currentUserId ?? "");
      setIsAdmin(d.isAdmin ?? false);
    } finally {
      setLoading(false);
    }
  }

  function openCreate() {
    setFUsername(""); setFName(""); setFEmail(""); setFRole("editor");
    setFPassword(""); setFEnabled(true); setFormError("");
    setModal({ kind: "create" });
  }

  function openEdit(user: AdminUser) {
    setFName(user.name); setFEmail(user.email); setFRole(user.role);
    setFEnabled(user.enabled); setFormError("");
    setModal({ kind: "edit", user });
  }

  function openPassword(userId: string, username: string) {
    setFPassword(""); setFormError("");
    setModal({ kind: "password", userId, username });
  }

  async function handleCreate(e: Event) {
    e.preventDefault();
    if (!fUsername.trim() || !fPassword) return;
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch(`${apiBase}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({
          username: fUsername.trim(), name: fName.trim(), email: fEmail.trim(),
          role: fRole, password: fPassword, enabled: fEnabled,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setModal(null);
      await loadUsers();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(e: Event, userId: string) {
    e.preventDefault();
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch(`${apiBase}/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ name: fName.trim(), email: fEmail.trim(), role: fRole, enabled: fEnabled }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setModal(null);
      await loadUsers();
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePassword(e: Event, userId: string) {
    e.preventDefault();
    if (!fPassword) return;
    setSubmitting(true);
    setFormError("");
    try {
      const res = await fetch(`${apiBase}/users/${userId}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
        body: JSON.stringify({ password: fPassword }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setFormError((err as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      setModal(null);
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteUser(userId: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    await fetch(`${apiBase}/users/${userId}`, {
      method: "DELETE",
      headers: { "X-CSRF-Token": getCsrf() },
    });
    await loadUsers();
  }

  async function toggleEnabled(userId: string, enabled: boolean) {
    await fetch(`${apiBase}/users/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": getCsrf() },
      body: JSON.stringify({ enabled }),
    });
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, enabled } : u)));
  }

  const sorted = [...users].sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:1rem">
        <button class="btn btn-primary btn-sm" onClick={openCreate}>+ New User</button>
      </div>

      {loading ? (
        <p style="color:#718096">Loading users…</p>
      ) : (
        <table class="admin-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u) => (
              <tr key={u.id}>
                <td>
                  <code>{u.username}</code>
                  {u.id === currentUserId && <span class="badge" style="margin-left:.5rem">you</span>}
                </td>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role}</td>
                <td>
                  <button
                    class={`btn btn-xs ${u.enabled ? "btn-enabled" : "btn-disabled"}`}
                    onClick={() => toggleEnabled(u.id, !u.enabled)}
                  >
                    {u.enabled ? "Active" : "Disabled"}
                  </button>
                </td>
                <td>
                  <button class="btn btn-xs btn-outline" onClick={() => openEdit(u)}>Edit</button>
                  <button class="btn btn-xs btn-outline" onClick={() => openPassword(u.id, u.username)}>Password</button>
                  {u.id !== currentUserId && (
                    <button class="btn btn-xs btn-danger" onClick={() => deleteUser(u.id, u.username)}>Delete</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Create modal */}
      {modal?.kind === "create" && (
        <div class="modal">
          <div class="modal-backdrop" onClick={() => setModal(null)} />
          <div class="modal-content">
            <h3>New User</h3>
            <form onSubmit={handleCreate}>
              <div class="form-group">
                <label>Username</label>
                <input type="text" value={fUsername} onInput={(e) => setFUsername((e.target as HTMLInputElement).value)} required autoFocus />
              </div>
              <div class="form-group">
                <label>Display name</label>
                <input type="text" value={fName} onInput={(e) => setFName((e.target as HTMLInputElement).value)} />
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" value={fEmail} onInput={(e) => setFEmail((e.target as HTMLInputElement).value)} />
              </div>
              <div class="form-group">
                <label>Role</label>
                <select value={fRole} onChange={(e) => setFRole((e.target as HTMLSelectElement).value)}>
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div class="form-group">
                <label>Password</label>
                <input type="password" value={fPassword} onInput={(e) => setFPassword((e.target as HTMLInputElement).value)} required />
              </div>
              {formError && <p class="form-error">{formError}</p>}
              <div class="form-actions">
                <button type="button" class="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" class="btn btn-primary" disabled={submitting}>{submitting ? "Creating…" : "Create"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {modal?.kind === "edit" && (
        <div class="modal">
          <div class="modal-backdrop" onClick={() => setModal(null)} />
          <div class="modal-content">
            <h3>Edit {modal.user.username}</h3>
            <form onSubmit={(e) => handleEdit(e, modal.user.id)}>
              <div class="form-group">
                <label>Display name</label>
                <input type="text" value={fName} onInput={(e) => setFName((e.target as HTMLInputElement).value)} />
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" value={fEmail} onInput={(e) => setFEmail((e.target as HTMLInputElement).value)} />
              </div>
              {isAdmin && (
                <div class="form-group">
                  <label>Role</label>
                  <select value={fRole} onChange={(e) => setFRole((e.target as HTMLSelectElement).value)}>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
              )}
              <div class="form-group">
                <label>
                  <input type="checkbox" checked={fEnabled} onChange={(e) => setFEnabled((e.target as HTMLInputElement).checked)} />{" "}
                  Enabled
                </label>
              </div>
              {formError && <p class="form-error">{formError}</p>}
              <div class="form-actions">
                <button type="button" class="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" class="btn btn-primary" disabled={submitting}>{submitting ? "Saving…" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Password modal */}
      {modal?.kind === "password" && (
        <div class="modal">
          <div class="modal-backdrop" onClick={() => setModal(null)} />
          <div class="modal-content">
            <h3>Change password for {modal.username}</h3>
            <form onSubmit={(e) => handlePassword(e, modal.userId)}>
              <div class="form-group">
                <label>New password</label>
                <input type="password" value={fPassword} onInput={(e) => setFPassword((e.target as HTMLInputElement).value)} required autoFocus />
              </div>
              {formError && <p class="form-error">{formError}</p>}
              <div class="form-actions">
                <button type="button" class="btn btn-outline" onClick={() => setModal(null)}>Cancel</button>
                <button type="submit" class="btn btn-primary" disabled={submitting}>{submitting ? "Saving…" : "Save"}</button>
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
