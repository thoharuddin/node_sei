'use client';

import { useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { Alert, Badge, Empty, Field, Modal, PageHeader, Spinner, useAsync } from '../../../../components/ui';

const emptyForm = { code: '', name: '', parentId: '', isActive: true };

/** Flattens the location tree into indented rows (WH → Stock → Rack A/B/C). */
function flatten(nodes, depth = 0, out = []) {
  for (const node of nodes) {
    out.push({ ...node, depth });
    if (node.children?.length) flatten(node.children, depth + 1, out);
  }
  return out;
}

export default function LocationsPage() {
  const { isManager } = useAuth();
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);

  const tree = useAsync(() => api.locations({ tree: 1 }));
  const rows = tree.data ? flatten(tree.data.data) : [];

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    const payload = {
      code: form.code,
      name: form.name,
      parentId: form.parentId === '' ? null : Number(form.parentId),
      isActive: form.isActive,
    };
    try {
      if (editing === 'new') await api.createLocation(payload);
      else await api.updateLocation(editing, payload);
      setEditing(null);
      tree.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const deactivate = async (location) => {
    if (!window.confirm(`Deactivate ${location.code}? Stock history is kept.`)) return;
    try {
      await api.deleteLocation(location.id);
      tree.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader title="Locations" subtitle="Hierarchical storage locations — a parent location covers its children in audits">
        {isManager ? (
          <button
            className="btn-primary"
            onClick={() => {
              setEditing('new');
              setForm(emptyForm);
            }}
          >
            + New location
          </button>
        ) : null}
      </PageHeader>

      <Alert onClose={() => setError(null)}>{error}</Alert>

      <div className="card">
        {tree.loading ? (
          <Spinner />
        ) : rows.length === 0 ? (
          <Empty>No location defined</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Parent</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <span style={{ paddingLeft: l.depth * 18 }} className="font-mono text-xs font-semibold">
                        {l.depth > 0 ? '└ ' : ''}
                        {l.code}
                      </span>
                    </td>
                    <td>{l.name}</td>
                    <td className="text-slate-500">{l.parent ? l.parent.code : '—'}</td>
                    <td>
                      <Badge value={l.isActive ? 'approved' : 'cancelled'}>{l.isActive ? 'active' : 'inactive'}</Badge>
                    </td>
                    <td className="text-right">
                      {isManager ? (
                        <div className="flex justify-end gap-2">
                          <button
                            className="btn-secondary"
                            onClick={() => {
                              setEditing(l.id);
                              setForm({ code: l.code, name: l.name, parentId: l.parentId ?? '', isActive: l.isActive });
                            }}
                          >
                            Edit
                          </button>
                          {l.isActive ? (
                            <button className="btn-danger" onClick={() => deactivate(l)}>
                              Deactivate
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'New location' : 'Edit location'}
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
          <Field label="Code" hint="Must be unique, e.g. RACK-A">
            <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required />
          </Field>
          <Field label="Name">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Parent location">
            <select className="input" value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">— none (root) —</option>
              {rows
                .filter((l) => l.id !== editing)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {'— '.repeat(l.depth)}
                    {l.code} · {l.name}
                  </option>
                ))}
            </select>
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
