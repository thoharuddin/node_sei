'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { Alert, Badge, Empty, PageHeader, Pagination, Spinner, useAsync } from '../../../components/ui';

export default function AuditAssignmentsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const assignments = useAsync(() => api.assignments({ page, status, limit: 20 }), [page, status]);

  return (
    <>
      <PageHeader title="Audit Assignments" subtitle="Every assignment across all programs">
        <select
          className="input w-40"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All statuses</option>
          <option value="pending">pending</option>
          <option value="in_progress">in progress</option>
          <option value="done">done</option>
          <option value="cancelled">cancelled</option>
        </select>
      </PageHeader>

      <Alert>{assignments.error}</Alert>

      <div className="card">
        {assignments.loading ? (
          <Spinner />
        ) : assignments.data?.data?.length === 0 ? (
          <Empty>No assignment yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Program</th>
                  <th>Staff</th>
                  <th>Type</th>
                  <th>Target</th>
                  <th>Status</th>
                  <th className="text-right">Sessions</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(assignments.data?.data || []).map((a) => (
                  <tr key={a.id}>
                    <td className="text-slate-400">{a.id}</td>
                    <td>
                      <Link href={`/audit-programs/${a.auditProgramId}`} className="link">
                        {a.program?.name}
                      </Link>
                    </td>
                    <td>{a.assignedUsers?.map((u) => u.name).join(', ')}</td>
                    <td>
                      <Badge value={a.assignmentType === 'location' ? 'submitted' : 'staff'}>{a.assignmentType}</Badge>
                    </td>
                    <td className="font-mono text-xs">
                      {a.assignmentType === 'location'
                        ? a.locations?.map((l) => l.code).join(', ')
                        : a.products?.map((p) => p.sku).join(', ')}
                    </td>
                    <td>
                      <Badge value={a.status} />
                    </td>
                    <td className="text-right">{a.stats?.sessions ?? 0}</td>
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
        <Pagination meta={assignments.data?.meta} onPage={setPage} />
      </div>
    </>
  );
}
