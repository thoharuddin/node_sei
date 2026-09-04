'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { Alert, Badge, Empty, PageHeader, Pagination, Spinner, useAsync } from '../../../components/ui';
import { dateTime } from '../../../lib/format';

export default function AuditSessionsPage() {
  const { isManager } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const sessions = useAsync(() => api.sessions({ page, status, limit: 20 }), [page, status]);

  return (
    <>
      <PageHeader
        title="Audit Sessions"
        subtitle={isManager ? 'Every counting session; submitted ones await your review' : 'Your counting sessions'}
      >
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
          <option value="submitted">submitted</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
        </select>
      </PageHeader>

      <Alert>{sessions.error}</Alert>

      <div className="card">
        {sessions.loading ? (
          <Spinner />
        ) : sessions.data?.data?.length === 0 ? (
          <Empty>No audit session</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Program</th>
                  <th>Assignment</th>
                  <th>Staff</th>
                  <th>Status</th>
                  <th className="text-right">Items</th>
                  <th className="text-right">Differences</th>
                  <th>Submitted</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.data.data.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">#{s.id}</td>
                    <td>
                      <Link href={`/audit-programs/${s.assignment?.auditProgramId}`} className="link">
                        {s.assignment?.program?.name}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/audit-assignments/${s.auditAssignmentId}`} className="link">
                        #{s.auditAssignmentId}
                      </Link>
                    </td>
                    <td>{s.staff?.name}</td>
                    <td>
                      <Badge value={s.status} />
                    </td>
                    <td className="text-right">{s.stats?.items}</td>
                    <td className="text-right">{s.stats?.differences}</td>
                    <td className="whitespace-nowrap text-slate-500">{dateTime(s.submittedAt)}</td>
                    <td className="text-right">
                      <Link href={`/audit-sessions/${s.id}`} className="btn-secondary">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={sessions.data?.meta} onPage={setPage} />
      </div>
    </>
  );
}
