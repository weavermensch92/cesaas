'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMaybeAuth, isAdminRole } from './AuthGate';

interface Item {
  href: string;
  label: string;
  match?: (path: string) => boolean;
  adminOnly?: boolean;
}

const ITEMS: Item[] = [
  { href: '/leads',             label: 'Leads',              match: (p) => p === '/leads' || p.startsWith('/leads/') },
  { href: '/',                  label: 'Captures',           match: (p) => p === '/' || p.startsWith('/clusters') },
  { href: '/voice/dealers',     label: 'Voice · Dealers',    match: (p) => p.startsWith('/voice/dealers'), adminOnly: true },
  { href: '/voice/responses',   label: 'Voice · Responses',  match: (p) => p.startsWith('/voice/responses') },
  { href: '/voice/aggregates',  label: 'Voice · Insight',    match: (p) => p.startsWith('/voice/aggregates') },
  { href: '/voice/heatmap',     label: 'Voice · Heatmap',    match: (p) => p.startsWith('/voice/heatmap') },
  { href: '/studio',            label: 'Studio · V_60',      match: (p) => p.startsWith('/studio') },
  { href: '/t-test',            label: 'T_08 · 통과 판정',     match: (p) => p.startsWith('/t-test') },
  { href: '/dealers',           label: '딜러 등록',           match: (p) => p === '/dealers' || p.startsWith('/dealers/'), adminOnly: true },
  { href: '/sensor/keys',       label: 'Sensor · 발급',       match: (p) => p.startsWith('/sensor/keys'), adminOnly: true },
  { href: '/sensor/crm',        label: 'Sensor · CRM',        match: (p) => p.startsWith('/sensor/crm'),  adminOnly: true },
  { href: '/llm',               label: 'LLM · 운영',          match: (p) => p.startsWith('/llm'),     adminOnly: true },
  // /gridge (위버 · 룰 편집) — 의도적으로 nav 미노출. URL 직접 접속만 (https://.../gridge). admin/super_admin gate는 페이지에서 강제.
  { href: '/members',           label: '회원 관리',           match: (p) => p.startsWith('/members'), adminOnly: true },
  { href: '/account',           label: '내 계정',             match: (p) => p.startsWith('/account') },
];

export function SectionNav() {
  const path = usePathname();
  const auth = useMaybeAuth();
  const isAdmin = !!auth && isAdminRole(auth.me.role);

  return (
    <div className="hd-subnav" style={{ overflowX: 'auto' }}>
      {ITEMS.filter((it) => !it.adminOnly || isAdmin).map((it) => {
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
