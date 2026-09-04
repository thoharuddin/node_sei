'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { Alert, Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner, useAsync } from '../../../../components/ui';
import { MOVEMENT_LABELS, dateTime, qty, signed } from '../../../../lib/format';

/**
 * Product stock screen: current balance per location plus the read-only stock_quant
 * movement history (§32).
 */
export default function ProductStockPage({ params }) {
  const id = Number(params.id);
  const { isManager } = useAuth();
  const [locationId, setLocationId] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [form, setForm] = useState({ movementType: 'receipt', locationId: '', quantity: '' });

  const product = useAsync(() => api.product(id), [id]);
  const movements = useAsync(() => api.movements({ productId: id, locationId, page, limit: 20 }), [id, locationId, page]);

  const postMovement = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createMovement({
        movementType: form.movementType,
        lines: [{ productId: id, locationId: Number(form.locationId), quantity: Number(form.quantity) }],
      });
      setMovementOpen(false);
      setForm({ movementType: 'receipt', locationId: '', quantity: '' });
      product.reload();
      movements.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  if (product.loading) return <Spinner />;
  if (product.error) return <Alert>{product.error}</Alert>;

  const p = product.data.data;

  return (
    <>
      <PageHeader title={`${p.sku} — ${p.name}`} subtitle={`Total quantity across all locations: ${qty(p.quantity)}`}>
        <Link href="/products" className="btn-secondary">
          ← Products
        </Link>
        {isManager ? (
          <button className="btn-primary" onClick={() => setMovementOpen(true)}>
            + Stock movement
          </button>
        ) : null}
      </PageHeader>

      <Alert onClose={() => setError(null)}>{error}</Alert>

      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Stock balance per location</h2>
          <Badge value={p.isActive ? 'approved' : 'cancelled'}>{p.isActive ? 'active' : 'inactive'}</Badge>
        </div>
        {p.balances.length === 0 ? (
          <Empty>This product has no stock record yet</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th className="text-right">Quantity</th>
                  <th>Last change</th>
                  <th className="text-right">Movements</th>
                </tr>
              </thead>
              <tbody>
                {p.balances.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <span className="font-mono text-xs">{b.location.code}</span> · {b.location.name}
                    </td>
                    <td className="text-right font-semibold">{qty(b.quantity)}</td>
                    <td className="text-slate-500">{dateTime(b.updatedAt)}</td>
                    <td className="text-right">
                      <button
                        className="btn-secondary"
                        onClick={() => {
                          setPage(1);
                          setLocationId(String(b.locationId));
                        }}
                      >
                        Filter history
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Stock movement history (read-only ledger)
            </h2>
            <p className="text-xs text-slate-400">stock_quant is append-only: corrections are new movements, never edits</p>
          </div>
          {locationId ? (
            <button className="btn-secondary" onClick={() => setLocationId('')}>
              Clear location filter
            </button>
          ) : null}
        </div>
        {movements.loading ? (
          <Spinner />
        ) : movements.data?.data?.length === 0 ? (
          <Empty>No movement recorded</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Location</th>
                  <th>Type</th>
                  <th className="text-right">Quantity</th>
                  <th>Reference</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {movements.data.data.map((m) => (
                  <tr key={m.id}>
                    <td className="text-slate-400">{m.id}</td>
                    <td className="whitespace-nowrap text-slate-500">{dateTime(m.createdAt)}</td>
                    <td className="font-mono text-xs">{m.location.code}</td>
                    <td>
                      <Badge value={m.movementType === 'audit_adjustment' ? 'submitted' : 'draft'}>
                        {MOVEMENT_LABELS[m.movementType] || m.movementType}
                      </Badge>
                    </td>
                    <td className={`text-right font-semibold ${m.quantity < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {signed(m.quantity)}
                    </td>
                    <td className="text-xs text-slate-500">
                      {m.adjustmentId ? (
                        <Link href={`/stock-adjustments?highlight=${m.adjustmentId}`} className="link">
                          adjustment #{m.adjustmentId}
                        </Link>
                      ) : (
                        `${m.referenceType || '—'}${m.referenceId ? ` #${m.referenceId}` : ''}`
                      )}
                    </td>
                    <td className="text-slate-500">{m.createdBy?.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={movements.data?.meta} onPage={setPage} />
      </div>

      <Modal
        open={movementOpen}
        title="Create stock movement"
        onClose={() => setMovementOpen(false)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setMovementOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={postMovement}>
              Post movement
            </button>
          </>
        }
      >
        <form onSubmit={postMovement}>
          <Field label="Movement type">
            <select className="input" value={form.movementType} onChange={(e) => setForm({ ...form, movementType: e.target.value })}>
              <option value="receipt">Receipt (+)</option>
              <option value="delivery">Delivery (−)</option>
              <option value="opening">Opening (+)</option>
              <option value="adjustment">Adjustment (signed)</option>
            </select>
          </Field>
          <Field label="Location">
            <select className="input" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} required>
              <option value="">Select a location…</option>
              {p.balances.map((b) => (
                <option key={b.locationId} value={b.locationId}>
                  {b.location.code} — {b.location.name} ({qty(b.quantity)})
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Quantity"
            hint={form.movementType === 'adjustment' ? 'Signed value, e.g. -5' : 'Positive magnitude; the sign is applied by the movement type'}
          >
            <input className="input" type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
          </Field>
        </form>
      </Modal>
    </>
  );
}
