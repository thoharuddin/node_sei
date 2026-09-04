'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { Alert, Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner, useAsync } from '../../../components/ui';
import { date } from '../../../lib/format';

const emptyForm = { name: '', description: '', auditDateFrom: '', auditDateTo: '' };

export default function AuditProgramsPage() {
  const { isManager } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);

  const programs = useAsync(() => api.programs({ page, status, limit: 20 }), [page, status]);

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createProgram({
        name: form.name,
        description: form.description || undefined,
        auditDateFrom: form.auditDateFrom,
        auditDateTo: form.auditDateTo,
      });
      setCreating(false);
      setForm(emptyForm);
      programs.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader title="Audit Programs" subtitle="A program groups the assignments of one stock opname campaign">
        <select
          className="input w-40"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All statuses</option>
          <option value="draft">draft</option>
          <option value="in_progress">in progress</option>
          <option value="completed">completed</option>
          <option value="cancelled">cancelled</option>
        </select>
        {isManager ? (
          <button className="btn-primary" onClick={() => setCreating(true)}>
            + New program
          </button>
        ) : null}
      </PageHeader>

      <Alert onClose={() => setError(null)}>{error}</Alert>

      <div className="card">
        {programs.loading ? (
          <Spinner />
        ) : programs.data?.data?.length === 0 ? (
          <Empty>No audit program yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Program</th>
                  <th>Audit dates</th>
                  <th>Status</th>
                  <th className="text-right">Assignments</th>
                  <th className="text-right">Sessions</th>
                  <th className="text-right">Submitted</th>
                  <th className="text-right">Approved</th>
                  <th className="text-right">Pending review</th>
                </tr>
              </thead>
              <tbody>
                {programs.data.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/audit-programs/${p.id}`} className="link font-medium">
                        {p.name}
                      </Link>
                      {p.description ? <div className="text-xs text-slate-400">{p.description}</div> : null}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {date(p.auditDateFrom)} → {date(p.auditDateTo)}
                    </td>
                    <td>
                      <Badge value={p.status} />
                    </td>
                    <td className="text-right">{p.stats.assignments}</td>
                    <td className="text-right">{p.stats.sessions}</td>
                    <td className="text-right">{p.stats.submitted}</td>
                    <td className="text-right text-emerald-600">{p.stats.approved}</td>
                    <td className="text-right text-amber-600">{p.stats.pendingReview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={programs.data?.meta} onPage={setPage} />
      </div>

      <Modal
        open={creating}
        title="New audit program"
        onClose={() => setCreating(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Create
            </button>
          </>
        }
      >
        <form onSubmit={save}>
          <Field label="Name">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="Stock Opname September 2026" />
          </Field>
          <Field label="Description">
            <textarea className="input" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Audit date from">
              <input className="input" type="date" value={form.auditDateFrom} onChange={(e) => setForm({ ...form, auditDateFrom: e.target.value })} required />
            </Field>
            <Field label="Audit date to">
              <input className="input" type="date" value={form.auditDateTo} onChange={(e) => setForm({ ...form, auditDateTo: e.target.value })} required />
            </Field>
          </div>
        </form>
      </Modal>
    </>
  );
}
