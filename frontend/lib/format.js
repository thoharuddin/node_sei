export const qty = (value) =>
  value === null || value === undefined
    ? '—'
    : Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const signed = (value) => {
  const n = Number(value || 0);
  return `${n > 0 ? '+' : ''}${qty(n)}`;
};

export const date = (value) => (value ? new Date(value).toLocaleDateString() : '—');

export const dateTime = (value) => (value ? new Date(value).toLocaleString() : '—');

export const MOVEMENT_LABELS = {
  opening: 'Opening',
  receipt: 'Receipt',
  delivery: 'Delivery',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
  adjustment: 'Adjustment',
  audit_adjustment: 'Audit Adjustment',
};
