'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/review', label: 'Review' },
  { href: '/admin/add', label: 'Add posting' },
  { href: '/admin/sources', label: 'Sources' },
  { href: '/admin/import', label: 'Sheet sync' },
  { href: '/admin/manage', label: 'Published' },
  { href: '/admin/duplicates', label: 'Duplicates' },
  { href: '/admin/integrations', label: 'Integrations' },
] as const;

function isActive(pathname: string, item: (typeof NAV_ITEMS)[number]) {
  if ('exact' in item && item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function OfficerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/admin/login') {
    return <div className="site-wrap officer-login-frame">{children}</div>;
  }

  return (
    <div className="site-wrap officer-shell">
      <section className="officer-portal-bar" aria-label="Officer workspace">
        <div className="officer-portal-copy">
          <div className="officer-portal-kicker">Private operations</div>
          <div className="officer-portal-name">
            <span className="officer-portal-signal" aria-hidden="true" />
            Officer workspace
          </div>
          <p>Review, verify, and operate the Career Hub without exposing private workflow data.</p>
        </div>
        <div className="officer-portal-actions">
          <Link href="/" className="officer-public-link">View public site <span aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <nav className="officer-nav" aria-label="Officer navigation">
        <div className="officer-nav-scroll">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? 'officer-nav-link is-active' : 'officer-nav-link'}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="officer-content">{children}</div>
    </div>
  );
}
