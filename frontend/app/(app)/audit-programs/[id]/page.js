'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { Alert, Badge, Empty, Field, Modal, PageHeader, Spinner, useAsync } from '../../../../components/ui';
import { date } from '../../../../lib/format';

const TABS = ['Overview', 'Assignments', 'Sessions'];

export default function AuditProgramPage({ params }) {
  const id = Number(params.id);
  const { isManager } = useAuth();
  const [tab, setTab] = useState('Overview');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ assignmentType: 'location', assignedUserIds: [], targets: [], notes: '' });

  const dashboard = useAsync(() => api.programDashboard(id), [id]);
  const sessions = useAsync(() => api.sessions({ programId: id, limit: 100 }), [id]);
  const staff = useAsync(() => (isManager ? api.users({ role: 'staff', isActive: 'true', limit: 100 }) : Promise.resolve({ data: [] })), [isManager]);
  const products = useAsync(() => api.products({ isActive: 'true', limit: 200 }));
  const locations = useAsync(() => api.locations({ isActive: 'true', limit: 200 }));

  const createAssignment = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createAssignment(id, {
        assignedUserIds: form.assignedUserIds.map(Number),
        assignmentType: form.assignmentType,
        ...(form.assignmentType === 'product'
          ? { productIds: form.targets.map(Number) }
          : { locationIds: form.targets.map(Number) }),
        notes: form.notes || undefined,
      });
      setCreating(false);
      setForm({ assignmentType: 'location', assignedUserIds: [], targets: [], notes: '' });
      dashboard.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const changeStatus = async (status) => {
    setError(null);
    try {
      await api.updateProgram(id, { status });
      dashboard.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (dashboard.loading) return <Spinner />;
  if (dashboard.error) return <Alert>{dashboard.error}</Alert>;

  const { program, assignments } = dashboard.data.data;
  const stats = program.stats;
  const multi = (values) => Array.from(values).map((o) => o.value);

  return (
    <>
      <PageHeader
        title={program.name}
        subtitle={`${date(program.auditDateFrom)} → ${date(program.auditDateTo)}${program.description ? ` · ${program.description}` : ''}`}
      >
        <Badge value={program.status} />
        <Link href="/audit-programs" className="btn-secondary">
          ← Programs
        </Link>
        {isManager && program.status === 'in_progress' ? (
          <button className="btn-success" onClick={() => changeStatus('completed')}>
            Complete program
          </button>
        ) : null}
        {isManager && ['draft', 'in_progress'].includes(program.status) ? (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New assignment
          </button>
        ) : null}
      </PageHeader>

      <Alert onClose={() => setError(null)}>{error}</Alert>

      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {[
            ['Assignments', stats.assignments],
            ['Sessions', stats.sessions],
            ['In progress', stats.draft],
            ['Submitted', stats.submitted],
            ['Approved', stats.approved],
            ['Pending review', stats.pendingReview],
          ].map(([label, value]) => (
            <div key={label} className="card px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
              <div className="mt-1 text-2xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {tab === 'Assignments' ? (
        <div className="card">
          {assignments.length === 0 ? (
            <Empty>No assignment in this program</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Staff</th>
                    <th>Type</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th className="text-right">Sessions</th>
                    <th className="text-right">Submitted</th>
                    <th className="text-right">Approved</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td className="text-slate-400">{a.id}</td>
                      <td>{a.assignedUsers.map((u) => u.name).join(', ')}</td>
                      <td>
                        <Badge value={a.assignmentType === 'location' ? 'submitted' : 'staff'}>{a.assignmentType}</Badge>
                      </td>
                      <td className="font-mono text-xs">
                        {a.assignmentType === 'location'
                          ? a.locations.map((l) => l.code).join(', ')
                          : a.products.map((p) => p.sku).join(', ')}
                      </td>
                      <td>
                        <Badge value={a.status} />
                      </td>
                      <td className="text-right">{a.stats.sessions}</td>
                      <td className="text-right">{a.stats.submitted}</td>
                      <td className="text-right text-emerald-600">{a.stats.approved}</td>
                      <td className="text-right">
                        <Link href={`/audit-assignments/${a.id}`} className="btn-secondary">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'Sessions' ? (
        <div className="card">
          {sessions.loading ? (
            <Spinner />
          ) : sessions.data?.data?.length === 0 ? (
            <Empty>No audit session in this program</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Assignment</th>
                    <th>Staff</th>
                    <th>Status</th>
                    <th className="text-right">Items</th>
                    <th className="text-right">Differences</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.data.data.map((s) => (
                    <tr key={s.id}>
                      <td className="font-medium">#{s.id}</td>
                      <td className="text-slate-500">#{s.auditAssignmentId}</td>
                      <td>{s.staff?.name}</td>
                      <td>
                        <Badge value={s.status} />
                      </td>
                      <td className="text-right">{s.stats?.items}</td>
                      <td className="text-right">{s.stats?.differences}</td>
                      <td className="text-right">
                        <Link href={`/audit-sessions/${s.id}`} className="btn-secondary">
                          Review
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      <Modal
        open={creating}
        title="New audit assignment"
        onClose={() => setCreating(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={createAssignment}>
              Create assignment
            </button>
          </>
        }
      >
        <form onSubmit={createAssignment}>
          <Field label="Assignment type" hint="A location assignment covers every product with stock in that location (and its children)">
            <select
              className="input"
              value={form.assignmentType}
              onChange={(e) => setForm({ ...form, assignmentType: e.target.value, targets: [] })}
            >
              <option value="location">location</option>
              <option value="product">product</option>
            </select>
          </Field>
          <Field label="Assigned staff" hint="Hold ⌘/Ctrl to select several — each one counts in their own session">
            <select
              className="input h-28"
              multiple
              value={form.assignedUserIds}
              onChange={(e) => setForm({ ...form, assignedUserIds: multi(e.target.selectedOptions) })}
              required
            >
              {(staff.data?.data || []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.username})
                </option>
              ))}
            </select>
          </Field>
          <Field label={form.assignmentType === 'product' ? 'Products' : 'Locations'}>
            <select
              className="input h-32"
              multiple
              value={form.targets}
              onChange={(e) => setForm({ ...form, targets: multi(e.target.selectedOptions) })}
              required
            >
              {form.assignmentType === 'product'
                ? (products.data?.data || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))
                : (locations.data?.data || []).map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.code} — {l.name}
                    </option>
                  ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </form>
      </Modal>
    </>
  );
}
