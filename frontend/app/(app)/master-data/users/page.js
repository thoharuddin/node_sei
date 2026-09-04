'use client';

import { useState } from 'react';
import { api } from '../../../../lib/api';
import { Alert, Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner, useAsync } from '../../../../components/ui';
import { dateTime } from '../../../../lib/format';

const emptyForm = { username: '', name: '', email: '', role: 'staff', password: '', isActive: true };

export default function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);

  const users = useAsync(() => api.users({ page, search, limit: 20 }), [page, search]);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      if (editing === 'new') {
        await api.createUser(form);
      } else {
        const payload = { name: form.name, email: form.email, role: form.role, isActive: form.isActive };
        if (form.password) payload.password = form.password;
        await api.updateUser(editing, payload);
      }
      setEditing(null);
      users.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const deactivate = async (user) => {
    if (!window.confirm(`Deactivate ${user.username}? The account is kept for history.`)) return;
    try {
      await api.deleteUser(user.id);
      users.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader title="Users" subtitle="Managers administer the system; staff perform the physical counting">
        <input
          className="input w-48"
          placeholder="Search…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        <button
          className="btn-primary"
          onClick={() => {
            setEditing('new');
            setForm(emptyForm);
          }}
        >
          + New user
        </button>
      </PageHeader>

      <Alert onClose={() => setError(null)}>{error}</Alert>

      <div className="card">
        {users.loading ? (
          <Spinner />
        ) : users.data?.data?.length === 0 ? (
          <Empty>No user found</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.data.map((u) => (
                  <tr key={u.id}>
                    <td className="font-mono text-xs font-semibold">{u.username}</td>
                    <td>{u.name}</td>
                    <td className="text-slate-500">{u.email}</td>
                    <td>
                      <Badge value={u.role} />
                    </td>
                    <td>
                      <Badge value={u.isActive ? 'approved' : 'cancelled'}>{u.isActive ? 'active' : 'inactive'}</Badge>
                    </td>
                    <td className="text-slate-500">{dateTime(u.createdAt)}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          className="btn-secondary"
                          onClick={() => {
                            setEditing(u.id);
                            setForm({ username: u.username, name: u.name, email: u.email, role: u.role, password: '', isActive: u.isActive });
                          }}
                        >
                          Edit
                        </button>
                        {u.isActive ? (
                          <button className="btn-danger" onClick={() => deactivate(u)}>
                            Deactivate
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={users.data?.meta} onPage={setPage} />
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'New user' : 'Edit user'}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Save
            </button>
          </>
        }
      >
        <form onSubmit={save}>
          {editing === 'new' ? (
            <Field label="Username" hint="Unique; letters, digits, dot, dash, underscore">
              <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </Field>
          ) : null}
          <Field label="Name">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Role">
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="staff">staff</option>
              <option value="manager">manager</option>
            </select>
          </Field>
          <Field label={editing === 'new' ? 'Password' : 'New password'} hint="At least 8 characters; hashed with bcrypt">
            <input
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={editing === 'new'}
              placeholder={editing === 'new' ? '' : 'leave blank to keep the current password'}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
        </form>
      </Modal>
    </>
  );
}
