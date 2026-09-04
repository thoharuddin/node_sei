'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { Alert, Badge, Empty, Modal, PageHeader, Pagination, Spinner, useAsync } from '../../../components/ui';
import { MOVEMENT_LABELS, dateTime, signed } from '../../../lib/format';

/** §24 traceability: adjustment → session → assignment → program → staff → movements. */
export default function StockAdjustmentsPage({ searchParams }) {
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState(searchParams?.highlight ? Number(searchParams.highlight) : null);
  const [error, setError] = useState(null);

  const adjustments = useAsync(() => api.adjustments({ page, limit: 20 }), [page]);
  const detail = useAsync(() => (detailId ? api.adjustment(detailId) : Promise.resolve(null)), [detailId]);

  return (
    <>
      <PageHeader title="Stock Adjustments" subtitle="Every stock adjustment originates from one approved audit session" />

      <Alert onClose={() => setError(null)}>{error || adjustments.error}</Alert>

      <div className="card">
        {adjustments.loading ? (
          <Spinner />
        ) : adjustments.data?.data?.length === 0 ? (
          <Empty>No stock adjustment yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Audit session</th>
                  <th>Program</th>
                  <th>Counted by</th>
                  <th>Approved by</th>
                  <th>Posting</th>
                  <th>Created</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.data.data.map((a) => (
                  <tr key={a.id} className={detailId === a.id ? 'bg-brand-50/60' : ''}>
                    <td className="font-medium">{a.id}</td>
                    <td>
                      <Link href={`/audit-sessions/${a.auditSessionId}`} className="link">
                        #{a.auditSessionId}
                      </Link>
                    </td>
                    <td>{a.session?.assignment?.program?.name}</td>
                    <td>{a.session?.staff?.name}</td>
                    <td>{a.session?.approvedBy?.name}</td>
                    <td>
                      <Badge value={a.postingStatus} />
                      {a.postingError ? <div className="text-xs text-rose-500">{a.postingError}</div> : null}
                    </td>
                    <td className="whitespace-nowrap text-slate-500">{dateTime(a.createdAt)}</td>
                    <td className="text-right">
                      <button className="btn-secondary" onClick={() => setDetailId(a.id)}>
                        Movements
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={adjustments.data?.meta} onPage={setPage} />
      </div>

      <Modal open={detailId !== null} title={`Stock adjustment #${detailId}`} onClose={() => setDetailId(null)} wide>
        {detail.loading ? (
          <Spinner />
        ) : !detail.data?.data ? (
          <Empty>Not found</Empty>
        ) : (
          <>
            <div className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
              <div>
                <span className="text-slate-400">Audit program:</span> {detail.data.data.session?.assignment?.program?.name}
              </div>
              <div>
                <span className="text-slate-400">Audit session:</span> #{detail.data.data.auditSessionId} · counted by{' '}
                {detail.data.data.session?.staff?.name}
              </div>
              <div>
                <span className="text-slate-400">Approved by:</span> {detail.data.data.session?.approvedBy?.name} ·{' '}
                {dateTime(detail.data.data.session?.approvedAt)}
              </div>
              {detail.data.data.notes ? (
                <div>
                  <span className="text-slate-400">Notes:</span> {detail.data.data.notes}
                </div>
              ) : null}
            </div>
            {detail.data.data.movements?.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Location</th>
                    <th>Type</th>
                    <th className="text-right">Quantity</th>
                    <th>Posted</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.data.movements.map((m) => (
                    <tr key={m.id}>
                      <td className="font-mono text-xs font-semibold">{m.product.sku}</td>
                      <td className="font-mono text-xs">{m.location.code}</td>
                      <td>{MOVEMENT_LABELS[m.movementType]}</td>
                      <td className={`text-right font-semibold ${m.quantity < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {signed(m.quantity)}
                      </td>
                      <td className="text-slate-500">{dateTime(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>No movement posted — every counted difference was zero, or reconciliation is still queued</Empty>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
