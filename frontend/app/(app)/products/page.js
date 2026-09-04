'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { Alert, Badge, Empty, Field, Modal, PageHeader, Pagination, Spinner, useAsync } from '../../../components/ui';
import { qty } from '../../../lib/format';

const emptyForm = { sku: '', name: '', isActive: true };

export default function ProductsPage() {
  const { isManager } = useAuth();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const products = useAsync(() => api.products({ search, page, limit: 20 }), [search, page]);

  const openCreate = () => {
    setEditing('new');
    setForm(emptyForm);
  };
  const openEdit = (product) => {
    setEditing(product.id);
    setForm({ sku: product.sku, name: product.name, isActive: product.isActive });
  };

  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      if (editing === 'new') await api.createProduct(form);
      else await api.updateProduct(editing, form);
      setEditing(null);
      products.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const deactivate = async (product) => {
    if (!window.confirm(`Deactivate ${product.sku}? Historical stock records are kept.`)) return;
    try {
      const res = await api.deleteProduct(product.id);
      setNotice(`${product.sku} deactivated (${res.data.deleted} delete)`);
      products.reload();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <>
      <PageHeader title="Products" subtitle="Quantity is the sum of stock balances across every location">
        <input
          className="input w-48"
          placeholder="Search SKU or name…"
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
        />
        {isManager ? (
          <button className="btn-primary" onClick={openCreate}>
            + New product
          </button>
        ) : null}
      </PageHeader>

      <Alert onClose={() => setError(null)}>{error}</Alert>
      <Alert kind="success" onClose={() => setNotice(null)}>
        {notice}
      </Alert>

      <div className="card">
        {products.loading ? (
          <Spinner />
        ) : products.data?.data?.length === 0 ? (
          <Empty>No product matches this search</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Name</th>
                  <th className="text-right">Quantity</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.data.data.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono text-xs font-semibold">{p.sku}</td>
                    <td>{p.name}</td>
                    <td className="text-right">
                      {/* clicking the stock balance opens the read-only stock_quant history */}
                      <Link href={`/products/${p.id}`} className="link font-semibold" title="View stock balance and movement history">
                        {qty(p.quantity)}
                      </Link>
                    </td>
                    <td>
                      <Badge value={p.isActive ? 'approved' : 'cancelled'}>{p.isActive ? 'active' : 'inactive'}</Badge>
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/products/${p.id}`} className="btn-secondary">
                          Stock
                        </Link>
                        {isManager ? (
                          <>
                            <button className="btn-secondary" onClick={() => openEdit(p)}>
                              Edit
                            </button>
                            {p.isActive ? (
                              <button className="btn-danger" onClick={() => deactivate(p)}>
                                Deactivate
                              </button>
                            ) : null}
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
        <Pagination meta={products.data?.meta} onPage={setPage} />
      </div>

      <Modal
        open={editing !== null}
        title={editing === 'new' ? 'New product' : 'Edit product'}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button className="btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Save
            </button>
          </>
        }
      >
        <form onSubmit={save}>
          <Field label="SKU" hint="Must be unique">
            <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} required />
          </Field>
          <Field label="Name">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Active
          </label>
        </form>
      </Modal>
    </>
  );
}
