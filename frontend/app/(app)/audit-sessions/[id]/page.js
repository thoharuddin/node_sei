'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { Alert, Badge, ConfirmDialog, Empty, Field, Modal, PageHeader, Spinner, useAsync } from '../../../../components/ui';
import { dateTime, qty, signed } from '../../../../lib/format';

/**
 * The counting screen (staff, draft session) and the review screen (manager, submitted
 * session). Both edit audit_session_item.counted_quantity; the backend decides who may.
 */
export default function AuditSessionPage({ params }) {
  const id = Number(params.id);
  const { user, isManager } = useAuth();
  const [draft, setDraft] = useState({});
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logsFor, setLogsFor] = useState(null);
  const [rejecting, setRejecting] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const session = useAsync(() => api.session(id), [id]);
  const logs = useAsync(() => (logsFor ? api.itemLogs(logsFor) : Promise.resolve(null)), [logsFor]);

  const s = session.data?.data;

  useEffect(() => {
    if (s) setNotes(s.notes || '');
  }, [s?.id, s?.notes]);

  const isOwner = s && s.staffId === user.id;
  const staffEditable = isOwner && s?.status === 'draft';
  const managerEditable = isManager && ['draft', 'submitted'].includes(s?.status);
  const editable = staffEditable || managerEditable;

  const setCount = (itemId, value) => setDraft((d) => ({ ...d, [itemId]: value }));

  const save = async () => {
    const items = Object.entries(draft)
      .filter(([, value]) => value !== '' && value !== null && value !== undefined)
      .map(([itemId, value]) => ({ id: Number(itemId), countedQuantity: Number(value) }));
    if (items.length === 0 && notes === (s.notes || '')) {
      setNotice('Nothing changed');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.saveItems(id, {
        items: items.length ? items : [{ id: s.items[0].id }],
        notes,
        ...(isManager && reason ? { reason } : {}),
      });
      setDraft({});
      setNotice(`Saved · ${res.data.changesLogged} change(s) written to the audit trail`);
      session.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn, message) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setNotice(message);
      session.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (session.loading) return <Spinner />;
  if (session.error) return <Alert>{session.error}</Alert>;

  const totalDiff = s.items.reduce((acc, i) => acc + Number(i.difference), 0);

  return (
    <>
      <PageHeader
        title={`Audit session #${s.id}`}
        subtitle={`${s.assignment?.program?.name} · assignment #${s.auditAssignmentId} · counted by ${s.staff.name}`}
      >
        <Badge value={s.status} />
        <Link href={`/audit-assignments/${s.auditAssignmentId}`} className="btn-secondary">
          ← Assignment
        </Link>
        {editable ? (
          <button className="btn-primary" disabled={busy} onClick={save}>
            Save
          </button>
        ) : null}
        {staffEditable ? (
          <button className="btn-success" disabled={busy} onClick={() => setConfirming('submit')}>
            Submit Audit
          </button>
        ) : null}
        {isManager && s.status === 'submitted' ? (
          <>
            <button className="btn-success" disabled={busy} onClick={() => setConfirming('approve')}>
              Approve
            </button>
            <button className="btn-danger" disabled={busy} onClick={() => setRejecting(true)}>
              Reject
            </button>
          </>
        ) : null}
        {isManager && ['submitted', 'rejected'].includes(s.status) ? (
          <button className="btn-secondary" disabled={busy} onClick={() => act(() => api.reopenSession(id), 'Session reopened as draft')}>
            Reopen
          </button>
        ) : null}
      </PageHeader>

      <Alert onClose={() => setError(null)}>{error}</Alert>
      <Alert kind="success" onClose={() => setNotice(null)}>
        {notice}
      </Alert>
      {s.status === 'rejected' && s.rejectionReason ? <Alert kind="info">Rejected: {s.rejectionReason}</Alert> : null}
      {s.adjustment ? (
        <Alert kind="info">
          Stock adjustment #{s.adjustment.id} · posting {s.adjustment.postingStatus}
          {s.adjustment.postedAt ? ` at ${dateTime(s.adjustment.postedAt)}` : ' (queued for reconciliation)'} ·{' '}
          <Link href={`/stock-adjustments?highlight=${s.adjustment.id}`} className="link">
            view movements
          </Link>
        </Alert>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Items', s.stats?.items],
          ['Differences', s.stats?.differences],
          ['System total', qty(s.stats?.systemTotal)],
          ['Counted total', qty(s.stats?.countedTotal)],
          ['Net difference', signed(totalDiff)],
        ].map(([label, value]) => (
          <div key={label} className="card px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
          </div>
        ))}
      </div>

      <div className="card mb-6">
        <div className="card-header">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Counting sheet</h2>
            <p className="text-xs text-slate-400">
              System quantity is the snapshot taken at {dateTime(s.startedAt)} and never changes
            </p>
          </div>
          {managerEditable && !staffEditable ? (
            <input
              className="input w-72"
              placeholder="Reason for manager edits (stored in the audit trail)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          ) : null}
        </div>
        {s.items.length === 0 ? (
          <Empty>No item in this session</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Location</th>
                  <th className="text-right">System Qty</th>
                  <th className="text-right">Counted Qty</th>
                  <th className="text-right">Difference</th>
                  <th>Note</th>
                  <th>Edited by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {s.items.map((item) => {
                  const value = draft[item.id] ?? item.countedQuantity;
                  const diff = Number(value) - Number(item.systemQuantity);
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="font-mono text-xs font-semibold">{item.product.sku}</span>
                        <div className="text-xs text-slate-400">{item.product.name}</div>
                      </td>
                      <td className="font-mono text-xs">{item.location.code}</td>
                      <td className="text-right">{qty(item.systemQuantity)}</td>
                      <td className="text-right">
                        {editable ? (
                          <input
                            className="input w-24 text-right"
                            type="number"
                            step="0.001"
                            min="0"
                            value={value}
                            onChange={(e) => setCount(item.id, e.target.value)}
                          />
                        ) : (
                          qty(item.countedQuantity)
                        )}
                      </td>
                      <td className={`text-right font-semibold ${diff === 0 ? 'text-slate-400' : diff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {signed(diff)}
                      </td>
                      <td className="text-xs text-slate-500">{item.note || '—'}</td>
                      <td className="text-xs text-slate-500">{item.editedBy ? `${item.editedBy.name} · ${dateTime(item.editedAt)}` : '—'}</td>
                      <td className="text-right">
                        <button className="btn-secondary" onClick={() => setLogsFor(item.id)}>
                          History
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {editable ? (
          <div className="flex flex-wrap items-end gap-3 border-t border-slate-200 px-4 py-3">
            <div className="flex-1">
              <Field label="Session notes">
                <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
            <button className="btn-primary" disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        ) : s.notes ? (
          <div className="border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
            <span className="font-semibold">Notes:</span> {s.notes}
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming === 'submit'}
        title="Submit audit session"
        message="Submit this audit? Your counted quantities are sent to the manager for review and you will not be able to edit them afterwards."
        confirmLabel="Submit audit"
        tone="btn-success"
        busy={busy}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          act(() => api.submitSession(id), 'Audit submitted for review');
        }}
      />

      <ConfirmDialog
        open={confirming === 'approve'}
        title="Approve audit session"
        message="Approving creates one stock adjustment and posts a stock movement for every non-zero difference. Other sessions of this assignment are rejected automatically. This cannot be undone."
        confirmLabel="Approve and adjust stock"
        tone="btn-success"
        busy={busy}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          setConfirming(null);
          act(() => api.approveSession(id), 'Session approved and stock adjustment created');
        }}
      />

      <Modal open={logsFor !== null} title="Item change history" onClose={() => setLogsFor(null)} wide>
        {logs.loading ? (
          <Spinner />
        ) : !logs.data?.data?.length ? (
          <Empty>No change recorded for this item</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Field</th>
                <th>Old</th>
                <th>New</th>
                <th>By</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {logs.data.data.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-slate-500">{dateTime(l.changedAt)}</td>
                  <td className="font-mono text-xs">{l.field}</td>
                  <td>{l.oldValue ?? '—'}</td>
                  <td className="font-semibold">{l.newValue ?? '—'}</td>
                  <td>{l.changedBy?.name}</td>
                  <td className="text-slate-500">{l.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Modal>

      <Modal
        open={rejecting}
        title={`Reject session #${s.id}`}
        onClose={() => setRejecting(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRejecting(false)}>
              Cancel
            </button>
            <button
              className="btn-danger"
              disabled={busy || reason.trim().length < 3}
              onClick={() => {
                setRejecting(false);
                act(() => api.rejectSession(id, reason), 'Session rejected');
              }}
            >
              Reject session
            </button>
          </>
        }
      >
        <Field label="Reason" hint="Shown to the staff member">
          <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required />
        </Field>
      </Modal>
    </>
  );
}
