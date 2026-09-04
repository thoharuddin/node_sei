'use client';

import Link from 'next/link';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { Alert, Badge, Empty, PageHeader, Spinner, useAsync } from '../../../components/ui';
import { date } from '../../../lib/format';

function Stat({ label, value, tone = 'text-slate-900' }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, isManager } = useAuth();
  const programs = useAsync(() => api.programs({ limit: 50 }));
  const sessions = useAsync(() => api.sessions({ limit: 100 }));

  if (programs.loading || sessions.loading) return <Spinner />;

  const rows = programs.data?.data || [];
  const mySessions = sessions.data?.data || [];
  const totals = rows.reduce(
    (acc, p) => ({
      assignments: acc.assignments + p.stats.assignments,
      sessions: acc.sessions + p.stats.sessions,
      submitted: acc.submitted + p.stats.submitted,
      approved: acc.approved + p.stats.approved,
      pendingReview: acc.pendingReview + p.stats.pendingReview,
    }),
    { assignments: 0, sessions: 0, submitted: 0, approved: 0, pendingReview: 0 },
  );

  return (
    <>
      <PageHeader title={`Welcome, ${user.name}`} subtitle={isManager ? 'Audit programs overview' : 'Your audit activity'}>
        {isManager ? (
          <Link href="/audit-programs" className="btn-primary">
            Audit programs
          </Link>
        ) : (
          <Link href="/my-assignments" className="btn-primary">
            My assignments
          </Link>
        )}
      </PageHeader>

      <Alert onClose={programs.reload}>{programs.error || sessions.error}</Alert>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Programs" value={rows.length} />
        <Stat label="Assignments" value={totals.assignments} />
        <Stat label="Sessions" value={totals.sessions} />
        <Stat label="Approved" value={totals.approved} tone="text-emerald-600" />
        <Stat label="Pending review" value={totals.pendingReview} tone="text-amber-600" />
      </div>

      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Audit Programs</h2>
        </div>
        {rows.length === 0 ? (
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
                {rows.map((p) => (
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
                    <td className="text-right font-medium text-emerald-600">{p.stats.approved}</td>
                    <td className="text-right font-medium text-amber-600">{p.stats.pendingReview}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {isManager ? 'Recent audit sessions' : 'My audit sessions'}
          </h2>
          <Link href="/audit-sessions" className="link text-sm">
            View all
          </Link>
        </div>
        {mySessions.length === 0 ? (
          <Empty>No audit session yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Staff</th>
                  <th>Status</th>
                  <th className="text-right">Items</th>
                  <th className="text-right">Differences</th>
                </tr>
              </thead>
              <tbody>
                {mySessions.slice(0, 8).map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link href={`/audit-sessions/${s.id}`} className="link font-medium">
                        #{s.id}
                      </Link>
                      <div className="text-xs text-slate-400">{s.assignment?.program?.name}</div>
                    </td>
                    <td>{s.staff?.name}</td>
                    <td>
                      <Badge value={s.status} />
                    </td>
                    <td className="text-right">{s.stats?.items ?? '—'}</td>
                    <td className="text-right">{s.stats?.differences ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
