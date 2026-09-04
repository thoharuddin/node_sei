'use client';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const TOKEN_KEY = 'stock-opname.token';
const USER_KEY = 'stock-opname.user';

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (token) => window.localStorage.setItem(TOKEN_KEY, token),
  clear: () => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(USER_KEY);
  },
  getUser: () => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  },
  setUser: (user) => window.localStorage.setItem(USER_KEY, JSON.stringify(user)),
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `Request failed with status ${status}`);
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

/** Thin REST client; the JWT is attached to every call and 401 clears the session. */
export async function apiFetch(path, { method = 'GET', body, query } = {}) {
  const url = new URL(BASE_URL + path);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
  }

  const token = tokenStore.get();
  const res = await fetch(url.toString(), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const payload = res.status === 204 ? null : await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') {
      tokenStore.clear();
      if (!window.location.pathname.startsWith('/login')) window.location.href = '/login';
    }
    throw new ApiError(res.status, payload);
  }
  return payload;
}

export const api = {
  login: (username, password) => apiFetch('/auth/login', { method: 'POST', body: { username, password } }),
  me: () => apiFetch('/auth/me'),

  products: (query) => apiFetch('/products', { query }),
  product: (id) => apiFetch(`/products/${id}`),
  productStock: (id) => apiFetch(`/products/${id}/stock`),
  createProduct: (body) => apiFetch('/products', { method: 'POST', body }),
  updateProduct: (id, body) => apiFetch(`/products/${id}`, { method: 'PUT', body }),
  deleteProduct: (id) => apiFetch(`/products/${id}`, { method: 'DELETE' }),

  locations: (query) => apiFetch('/locations', { query }),
  createLocation: (body) => apiFetch('/locations', { method: 'POST', body }),
  updateLocation: (id, body) => apiFetch(`/locations/${id}`, { method: 'PUT', body }),
  deleteLocation: (id) => apiFetch(`/locations/${id}`, { method: 'DELETE' }),

  users: (query) => apiFetch('/users', { query }),
  createUser: (body) => apiFetch('/users', { method: 'POST', body }),
  updateUser: (id, body) => apiFetch(`/users/${id}`, { method: 'PUT', body }),
  deleteUser: (id) => apiFetch(`/users/${id}`, { method: 'DELETE' }),

  stock: (query) => apiFetch('/stock', { query }),
  movements: (query) => apiFetch('/stock/movements', { query }),
  movement: (id) => apiFetch(`/stock/movements/${id}`),
  createMovement: (body) => apiFetch('/stock/movements', { method: 'POST', body }),
  createTransfer: (body) => apiFetch('/stock/transfers', { method: 'POST', body }),

  programs: (query) => apiFetch('/audit-programs', { query }),
  program: (id) => apiFetch(`/audit-programs/${id}`),
  programDashboard: (id) => apiFetch(`/audit-programs/${id}/dashboard`),
  createProgram: (body) => apiFetch('/audit-programs', { method: 'POST', body }),
  updateProgram: (id, body) => apiFetch(`/audit-programs/${id}`, { method: 'PUT', body }),

  programAssignments: (id, query) => apiFetch(`/audit-programs/${id}/assignments`, { query }),
  createAssignment: (programId, body) => apiFetch(`/audit-programs/${programId}/assignments`, { method: 'POST', body }),
  assignments: (query) => apiFetch('/audit-assignments', { query }),
  assignment: (id) => apiFetch(`/audit-assignments/${id}`),
  updateAssignment: (id, body) => apiFetch(`/audit-assignments/${id}`, { method: 'PUT', body }),
  myAssignments: () => apiFetch('/audit-assignments/my'),
  comparison: (id) => apiFetch(`/audit-assignments/${id}/comparison`),
  startAudit: (id) => apiFetch(`/audit-assignments/${id}/start`, { method: 'POST' }),

  sessions: (query) => apiFetch('/audit-sessions', { query }),
  session: (id) => apiFetch(`/audit-sessions/${id}`),
  sessionItems: (id) => apiFetch(`/audit-sessions/${id}/items`),
  saveItems: (id, body) => apiFetch(`/audit-sessions/${id}/items`, { method: 'PUT', body }),
  submitSession: (id) => apiFetch(`/audit-sessions/${id}/submit`, { method: 'POST', body: {} }),
  approveSession: (id, body) => apiFetch(`/audit-sessions/${id}/approve`, { method: 'POST', body: body || {} }),
  rejectSession: (id, reason) => apiFetch(`/audit-sessions/${id}/reject`, { method: 'POST', body: { reason } }),
  reopenSession: (id) => apiFetch(`/audit-sessions/${id}/reopen`, { method: 'POST', body: {} }),
  updateItem: (id, body) => apiFetch(`/audit-session-items/${id}`, { method: 'PUT', body }),
  itemLogs: (id) => apiFetch(`/audit-session-items/${id}/logs`),

  adjustments: (query) => apiFetch('/stock-adjustments', { query }),
  adjustment: (id) => apiFetch(`/stock-adjustments/${id}`),
};
