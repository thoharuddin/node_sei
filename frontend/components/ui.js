'use client';

import { useEffect, useState } from 'react';

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const BADGE_STYLES = {
  draft: 'bg-slate-100 text-slate-700 ring-slate-200',
  pending: 'bg-slate-100 text-slate-700 ring-slate-200',
  in_progress: 'bg-amber-50 text-amber-700 ring-amber-200',
  submitted: 'bg-sky-50 text-sky-700 ring-sky-200',
  done: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  posted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-200',
  failed: 'bg-rose-50 text-rose-700 ring-rose-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
  manager: 'bg-brand-50 text-brand-700 ring-brand-100',
  staff: 'bg-violet-50 text-violet-700 ring-violet-200',
};

export function Badge({ value, children }) {
  const key = String(value || '').toLowerCase();
  const style = BADGE_STYLES[key] || 'bg-slate-100 text-slate-700 ring-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${style}`}>
      {children || String(value || '').replace(/_/g, ' ')}
    </span>
  );
}

export function Alert({ kind = 'error', children, onClose }) {
  if (!children) return null;
  const styles = {
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    info: 'border-sky-200 bg-sky-50 text-sky-800',
  };
  return (
    <div className={`mb-4 flex items-start justify-between gap-3 rounded-md border px-3 py-2 text-sm ${styles[kind]}`}>
      <div>{children}</div>
      {onClose ? (
        <button type="button" onClick={onClose} className="text-xs font-semibold uppercase opacity-70 hover:opacity-100">
          dismiss
        </button>
      ) : null}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8">
      <div className={`card w-full ${wide ? 'max-w-4xl' : 'max-w-lg'}`}>
        <div className="card-header">
          <h2 className="text-base font-semibold">{title}</h2>
          <button type="button" className="text-slate-400 hover:text-slate-600" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

/** In-app confirmation for the irreversible audit actions (submit, approve, reject). */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'btn-primary', busy, onConfirm, onClose }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className={tone} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="text-sm text-slate-600">{message}</p>
    </Modal>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="mb-3 block">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-slate-400">{hint}</span> : null}
    </label>
  );
}

export function Empty({ children = 'Nothing here yet' }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-400">{children}</div>;
}

export function Spinner({ label = 'Loading…' }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-400">{label}</div>;
}

/** Small helper for the many "load once, refresh on demand" pages. */
export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: null });

  const run = () => {
    setState((s) => ({ ...s, loading: true }));
    return loader()
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((error) => setState({ loading: false, data: null, error: error.message }));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, deps);

  return { ...state, reload: run, setState };
}

export function Pagination({ meta, onPage }) {
  if (!meta || !meta.pages || meta.pages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-sm text-slate-500">
      <span>
        Page {meta.page} of {meta.pages} · {meta.total} record(s)
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Previous
        </button>
        <button className="btn-secondary" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}
