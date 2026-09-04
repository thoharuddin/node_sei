'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { Alert, Badge, Empty, PageHeader, Spinner, useAsync } from '../../../components/ui';
import { date, dateTime } from '../../../lib/format';

/** Staff landing page: My Assignments → Start Audit → counting screen (§18/§32). */
export default function MyAssignmentsPage() {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const assignments = useAsync(() => api.myAssignments());

  const start = async (assignmentId) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.startAudit(assignmentId);
      router.push(`/audit-sessions/${res.data.id}`);
    } catch (err) {
      // an open session already exists → take the staff member straight to it
      if (err.status === 409 && err.details?.auditSessionId) {
        router.push(`/audit-sessions/${err.details.auditSessionId}`);
        return;
      }
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (assignments.loading) return <Spinner />;

  const rows = assignments.data?.data || [];

  return (
    <>
      <PageHeader title="My Assignments" subtitle="Audit work assigned to you" />

      <Alert onClose={() => setError(null)}>{error || assignments.error}</Alert>

      {rows.length === 0 ? (
        <div className="card">
          <Empty>No assignment for you right now</Empty>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map((a) => {
            const openSession = a.mySessions.find((s) => s.status === 'draft');
            const submitted = a.mySessions.filter((s) => s.status !== 'draft');
            // Once a session of the assignment is approved (or it was cancelled) there is
            // nothing left to count — the backend refuses a new session anyway.
            const canStart = a.status !== 'cancelled' && (a.stats?.approved ?? 0) === 0;
            return (
              <div key={a.id} className="card p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{a.program?.name}</div>
                    <div className="text-xs text-slate-400">
                      {date(a.program?.auditDateFrom)} → {date(a.program?.auditDateTo)} · assignment #{a.id}
                    </div>
                  </div>
                  <Badge value={a.status} />
                </div>

                <div className="my-3 rounded-md bg-slate-50 px-3 py-2 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {a.assignmentType === 'location' ? 'Locations to count' : 'Products to count'}
                  </div>
                  <div className="font-mono text-xs">
                    {a.assignmentType === 'location'
                      ? a.locations.map((l) => `${l.code} (${l.name})`).join(', ')
                      : a.products.map((p) => `${p.sku}`).join(', ')}
                  </div>
                  {a.notes ? <div className="mt-1 text-xs text-slate-500">{a.notes}</div> : null}
                </div>

                {a.mySessions.length ? (
                  <ul className="mb-3 space-y-1 text-sm">
                    {a.mySessions.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <span>
                          <Link href={`/audit-sessions/${s.id}`} className="link">
                            Session #{s.id}
                          </Link>
                          <span className="ml-2 text-xs text-slate-400">
                            {s.submittedAt ? `submitted ${dateTime(s.submittedAt)}` : `started ${dateTime(s.startedAt)}`}
                          </span>
                        </span>
                        <Badge value={s.status} />
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="flex gap-2">
                  {openSession ? (
                    <Link href={`/audit-sessions/${openSession.id}`} className="btn-primary">
                      Continue counting
                    </Link>
                  ) : canStart ? (
                    <button className="btn-primary" disabled={busy} onClick={() => start(a.id)}>
                      Start Audit
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">Counting closed for this assignment</span>
                  )}
                  {submitted.length ? (
                    <Link href={`/audit-sessions/${submitted[0].id}`} className="btn-secondary">
                      View last submission
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
