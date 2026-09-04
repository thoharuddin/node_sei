'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { Alert, Field } from '../../components/ui';

export default function LoginPage() {
  const { login, user } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) router.replace('/dashboard');
  }, [user, router]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const logged = await login(form.username.trim(), form.password);
      router.replace(logged.role === 'staff' ? '/my-assignments' : '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold text-slate-900">Stock Opname System</h1>
        <p className="mb-5 text-sm text-slate-500">Sign in to continue</p>

        <Alert onClose={() => setError(null)}>{error}</Alert>

        <form onSubmit={submit}>
          <Field label="Username">
            <input
              className="input"
              value={form.username}
              autoComplete="username"
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          </Field>
          <Field label="Password">
            <input
              className="input"
              type="password"
              value={form.password}
              autoComplete="current-password"
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </Field>
          <button className="btn-primary mt-2 w-full" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-5 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
          <div className="font-semibold text-slate-600">Seeded accounts</div>
          <div>manager / manager123 — manager</div>
          <div>budi · andi · candra / staff123 — staff</div>
        </div>
      </div>
    </main>
  );
}
