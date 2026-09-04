'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { Badge } from './ui';

/** §32 menu: Products · Audit Program (assignments, sessions) · Master Data (users, locations) */
const MENU = [
  { href: '/products', label: 'Products', roles: ['manager', 'staff'] },
  { href: '/audit-programs', label: 'Audit Program', roles: ['manager', 'staff'], children: [
    { href: '/audit-assignments', label: 'Audit Assignment' },
    { href: '/audit-sessions', label: 'Audit Sessions' },
  ] },
  { href: '/my-assignments', label: 'My Assignments', roles: ['staff'] },
  { href: '/stock-adjustments', label: 'Stock Adjustments', roles: ['manager'] },
  { href: '/master-data/users', label: 'Users', roles: ['manager'], group: 'Master Data' },
  { href: '/master-data/locations', label: 'Locations', roles: ['manager', 'staff'], group: 'Master Data' },
];

export default function Nav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);

  const visible = MENU.filter((item) => !user || item.roles.includes(user.role));
  const main = visible.filter((i) => !i.group);
  const masterData = visible.filter((i) => i.group === 'Master Data');

  const isActive = (href) => pathname === href || pathname.startsWith(`${href}/`);

  const linkClass = (href, indent) =>
    `block rounded-md px-3 py-1.5 text-sm ${indent ? 'ml-3' : ''} ${
      isActive(href) ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-600 hover:bg-slate-100'
    }`;

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 lg:hidden">
        <button className="btn-secondary" onClick={() => setOpen((v) => !v)}>
          ☰ Menu
        </button>
        <span className="font-semibold">Stock Opname</span>
      </header>

      <aside
        className={`${open ? 'block' : 'hidden'} w-full shrink-0 border-b border-slate-200 bg-white p-3 lg:block lg:h-screen lg:w-64 lg:border-b-0 lg:border-r lg:sticky lg:top-0`}
      >
        <div className="mb-4 hidden px-2 lg:block">
          <div className="text-base font-semibold text-slate-900">Stock Opname</div>
          <div className="text-xs text-slate-400">Physical inventory audit</div>
        </div>

        <nav className="space-y-0.5" onClick={() => setOpen(false)}>
          <Link href="/dashboard" className={linkClass('/dashboard')}>
            Dashboard
          </Link>
          {main.map((item) => (
            <div key={item.href}>
              <Link href={item.href} className={linkClass(item.href)}>
                {item.label}
              </Link>
              {item.children && isActive(item.href)
                ? item.children.map((child) => (
                    <Link key={child.href} href={child.href} className={linkClass(child.href, true)}>
                      └ {child.label}
                    </Link>
                  ))
                : null}
            </div>
          ))}

          {masterData.length ? (
            <div className="pt-3">
              <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Master Data</div>
              {masterData.map((item) => (
                <Link key={item.href} href={item.href} className={linkClass(item.href, true)}>
                  └ {item.label}
                </Link>
              ))}
            </div>
          ) : null}
        </nav>

        {user ? (
          <div className="mt-6 border-t border-slate-200 pt-3">
            <div className="px-3 text-sm font-medium text-slate-700">{user.name}</div>
            <div className="mb-2 px-3">
              <Badge value={user.role} />
            </div>
            <button className="btn-secondary w-full" onClick={logout}>
              Sign out
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
}
