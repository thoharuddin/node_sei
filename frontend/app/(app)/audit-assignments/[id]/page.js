'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { Alert, Badge, ConfirmDialog, Empty, Field, Modal, PageHeader, Spinner, useAsync } from '../../../../components/ui';
import { dateTime, qty, signed } from '../../../../lib/format';

/**
 * Manager view of one assignment: its sessions, the side-by-side comparison of the staff
 * counts (§14) and the approve / reject actions (§19).
 */
export default function AuditAssignmentPage({ params }) {
  const id = Number(params.id);
  const { isManager, user } = useAuth();
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [approving, setApproving] = useState(null);
  const [rejectingAll, setRejectingAll] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const assignment = useAsync(() => api.assignment(id), [id]);
  const comparison = useAsync(
    () => (isManager ? api.comparison(id) : Promise.resolve(null)),
    [id, isManager],
  );

  const reload = () => {
    assignment.reload();
    comparison.reload();
  };

  const start = async () => {
    setError(null);
    try {
      const res = await api.startAudit(id);
      setNotice(`Audit session #${res.data.id} started with ${res.data.items.length} item(s)`);
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const approve = async (sessionId) => {
    setApproving(null);
    setBusy(true);
    setError(null);
    try {
      const res = await api.approveSession(sessionId);
      const d = res.data;
      setNotice(
        d.idempotent
          ? `Session #${sessionId} was already approved (adjustment #${d.adjustment.id})`
          : `Session #${sessionId} approved · stock adjustment #${d.adjustment.id} · ${
              d.adjustment.postingStatus === 'posted'
                ? `${d.movementsPosted} movement(s) posted`
                : 'movements queued for reconciliation'
            }${d.autoRejectedSessions.length ? ` · auto-rejected ${d.autoRejectedSessions.map((s) => `#${s}`).join(', ')}` : ''}`,
      );
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const reject = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.rejectSession(rejecting, reason);
      setRejecting(null);
      setReason('');
      setNotice(`Session #${rejecting} rejected`);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const rejectAll = async () => {
    setRejectingAll(false);
    const open = (assignment.data?.data?.sessions || []).filter((s) => ['draft', 'submitted'].includes(s.status));
    if (open.length === 0) return;
    setBusy(true);
    try {
      for (const session of open) {
        // eslint-disable-next-line no-await-in-loop
        await api.rejectSession(session.id, 'Rejected by manager — recount required');
      }
      setNotice(`${open.length} session(s) rejected`);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (assignment.loading) return <Spinner />;
  if (assignment.error) return <Alert>{assignment.error}</Alert>;

  const a = assignment.data.data;
  const sessions = a.sessions || [];
  const cmp = comparison.data?.data;
  const canStart =
    !isManager &&
    a.assignedUserIds.includes(user.id) &&
    a.status !== 'cancelled' &&
    !sessions.some((s) => s.status === 'approved') &&
    !sessions.some((s) => s.staffId === user.id && s.status === 'draft');

  return (
    <>
      <PageHeader
        title={`Assignment #${a.id}`}
        subtitle={`${a.program?.name} · ${a.assignmentType} assignment · ${
          a.assignmentType === 'location'
            ? a.locations.map((l) => `${l.code} (${l.name})`).join(', ')
            : a.products.map((p) => p.sku).join(', ')
        }`}
      >
        <Badge value={a.status} />
        <Link href={`/audit-programs/${a.auditProgramId}`} className="btn-secondary">
          ← Program
        </Link>
        {canStart ? (
          <button className="btn-primary" onClick={start}>
            Start Audit
          </button>
        ) : null}
        {isManager && sessions.some((s) => ['draft', 'submitted'].includes(s.status)) ? (
          <button className="btn-danger" onClick={() => setRejectingAll(true)} disabled={busy}>
            Reject all
          </button>
        ) : null}
      </PageHeader>

      <Alert onClose={() => setError(null)}>{error}</Alert>
      <Alert kind="success" onClose={() => setNotice(null)}>
        {notice}
      </Alert>

      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Audit sessions</h2>
          <span className="text-xs text-slate-400">
            Assigned staff: {a.assignedUsers.map((u) => u.name).join(', ')}
          </span>
        </div>
        {sessions.length === 0 ? (
          <Empty>No session started yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Staff</th>
                  <th>Status</th>
                  <th>Started</th>
                  <th>Submitted</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">#{s.id}</td>
                    <td>{s.staff?.name}</td>
                    <td>
                      <Badge value={s.status} />
                      {s.rejectionReason ? <div className="text-xs text-slate-400">{s.rejectionReason}</div> : null}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{dateTime(s.startedAt)}</td>
                    <td className="whitespace-nowrap text-slate-500">{dateTime(s.submittedAt)}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/audit-sessions/${s.id}`} className="btn-secondary">
                          {isManager ? 'Review' : 'Open'}
                        </Link>
                        {isManager && s.status === 'submitted' ? (
                          <>
                            <button className="btn-success" disabled={busy} onClick={() => setApproving(s.id)}>
                              Approve {s.staff?.name?.split(' ')[0]}
                            </button>
                            <button className="btn-danger" disabled={busy} onClick={() => setRejecting(s.id)}>
                              Reject
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isManager ? (
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Audit comparison</h2>
              <p className="text-xs text-slate-400">
                System quantity is the snapshot taken when each session started
                {cmp?.summary ? ` · ${cmp.summary.disagreements} of ${cmp.summary.rows} row(s) disagree` : ''}
              </p>
            </div>
          </div>
          {comparison.loading ? (
            <Spinner />
          ) : !cmp || cmp.rows.length === 0 ? (
            <Empty>Nothing to compare yet</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Location</th>
                    <th className="text-right">System</th>
                    {cmp.sessions.map((s) => (
                      <th key={s.id} className="text-right">
                        {s.staff.name.split(' ')[0]} (#{s.id})
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {cmp.rows.map((row) => (
                    <tr key={`${row.productId}-${row.locationId}`}>
                      <td>
                        <span className="font-mono text-xs font-semibold">{row.product.sku}</span>
                        <div className="text-xs text-slate-400">{row.product.name}</div>
                      </td>
                      <td className="font-mono text-xs">{row.location.code}</td>
                      <td className="text-right">{qty(row.systemQuantity)}</td>
                      {cmp.sessions.map((s) => {
                        const cell = row.counts[s.id];
                        return (
                          <td key={s.id} className="text-right">
                            {cell ? (
                              <span className={cell.difference === 0 ? '' : 'font-semibold text-amber-600'}>
                                {qty(cell.countedQuantity)}
                                <span className="ml-1 text-xs text-slate-400">({signed(cell.difference)})</span>
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="text-right">
                        {row.agree ? (
                          <Badge value="approved">agree</Badge>
                        ) : (
                          <Badge value="rejected">differs</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cmp?.sessions?.some((s) => s.status === 'submitted') ? (
            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
              {cmp.sessions
                .filter((s) => s.status === 'submitted')
                .map((s) => (
                  <button key={s.id} className="btn-success" disabled={busy} onClick={() => setApproving(s.id)}>
                    Approve {s.staff.name.split(' ')[0]}&apos;s session
                  </button>
                ))}
              <button className="btn-danger" disabled={busy} onClick={() => setRejectingAll(true)}>
                Reject all
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={approving !== null}
        title={`Approve session #${approving}`}
        message="Approving creates one stock adjustment and posts a stock movement for every non-zero difference. The other sessions of this assignment are rejected automatically. This cannot be undone."
        confirmLabel="Approve and adjust stock"
        tone="btn-success"
        busy={busy}
        onClose={() => setApproving(null)}
        onConfirm={() => approve(approving)}
      />

      <ConfirmDialog
        open={rejectingAll}
        title="Reject all open sessions"
        message="Every draft and submitted session of this assignment is rejected. The staff members will have to recount after you reopen a session."
        confirmLabel="Reject all sessions"
        tone="btn-danger"
        busy={busy}
        onClose={() => setRejectingAll(false)}
        onConfirm={rejectAll}
      />

      <Modal
        open={rejecting !== null}
        title={`Reject session #${rejecting}`}
        onClose={() => setRejecting(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRejecting(null)}>
              Cancel
            </button>
            <button className="btn-danger" onClick={reject} disabled={busy}>
              Reject session
            </button>
          </>
        }
      >
        <form onSubmit={reject}>
          <Field label="Reason" hint="Shown to the staff member; stored on the session">
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} />
          </Field>
        </form>
      </Modal>
    </>
  );
}
