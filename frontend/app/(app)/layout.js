'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Nav from '../../components/nav';
import { useAuth } from '../../lib/auth';
import { Spinner } from '../../components/ui';

export default function AppLayout({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) return <Spinner label="Loading session…" />;
  if (!user) return null;

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <Nav />
      <main className="flex-1 p-4 lg:p-6">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
