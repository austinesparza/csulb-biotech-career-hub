'use client';

import Link from 'next/link';
import { useRef } from 'react';

const LINKS = [
  ['/internships', 'Opportunities'],
  ['/calendar', 'Calendar'],
  ['/eligibility', 'Application help'],
  ['/companies', 'Employers'],
  ['/about', 'About'],
  ['/submit', 'Submit a role'],
] as const;

export function MobileNavigation() {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  function closeNavigation() {
    if (detailsRef.current) detailsRef.current.open = false;
  }

  return (
    <details className="mobile-nav" ref={detailsRef}>
      <summary aria-label="Open navigation">
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span className="mobile-nav-label">Menu</span>
      </summary>
      <nav aria-label="Mobile navigation">
        {LINKS.map(([href, label]) => (
          <Link href={href} onNavigate={closeNavigation} key={href}>{label}</Link>
        ))}
      </nav>
    </details>
  );
}
