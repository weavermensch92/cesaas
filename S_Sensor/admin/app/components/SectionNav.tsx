'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Item {
  href: string;
  label: string;
  match?: (path: string) => boolean;
}

const ITEMS: Item[] = [
  { href: '/leads',             label: 'Leads',              match: (p) => p === '/leads' || p.startsWith('/leads/') },
  { href: '/',                  label: 'Captures',           match: (p) => p === '/' || p.startsWith('/clusters') },
  { href: '/voice/responses',   label: 'Voice · Responses',  match: (p) => p.startsWith('/voice/responses') },
  { href: '/voice/aggregates',  label: 'Voice · Insight',    match: (p) => p.startsWith('/voice/aggregates') },
  { href: '/studio',            label: 'Studio · V_60',      match: (p) => p.startsWith('/studio') },
  { href: '/t-test',            label: 'T_08 · 통과 판정',     match: (p) => p.startsWith('/t-test') },
];

export function SectionNav() {
  const path = usePathname();
  return (
    <div className="hd-subnav" style={{ overflowX: 'auto' }}>
      {ITEMS.map((it) => {
        const active = it.match ? it.match(path ?? '') : (path === it.href);
        return (
          <Link key={it.href} href={it.href} className={`hd-snav ${active ? 'active' : ''}`}>
            {it.label}
          </Link>
        );
      })}
    </div>
  );
}
