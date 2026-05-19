'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Lang } from '@hd/design/i18n';
import { AuthGate, isAdminRole } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  listMembers, inviteMember, updateMemberRole,
  type MemberRow, type UserRole, type MeProfile,
} from '@/lib/api';

const LANG: Lang = 'ko';

const inputStyle: React.CSSProperties = {
  height: 36, padding: '0 12px', border: 'var(--hd-border)',
  borderRadius: 'var(--hd-radius)', font: 'inherit', color: 'var(--hd-ink)',
};

const roleLabel: Record<UserRole, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  regular: '일반',
};

export default function MembersPage() {
  return <AuthGate>{({ session, me }) => <View email={session.user.email ?? ''} me={me} />}</AuthGate>;
}

function View({ email, me }: { email: string; me: MeProfile }) {
  const signOut = () => { getSupabase().auth.signOut(); };
  const isAdmin = isAdminRole(me.role);

  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true); setErr(null);
    try {
      const r = await listMembers();
      setRows(r.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [isAdmin]);

  useEffect(() => { refresh(); }, [refresh]);

  if (!isAdmin) {
    return (
      <>
        <TopBar lang={LANG} email={email} onSignOut={signOut} />
        <SectionNav />
        <main style={{ padding: 18 }}>
          <div className="hd-card" style={{ padding: 18 }}>
            <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>접근 권한 없음</h2>
            <p className="hd-meta">회원 관리는 Admin / Super Admin 만 가능합니다.</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />
      <main style={{ padding: 18, display: 'grid', gap: 18 }}>
        {err && (
          <div className="hd-card" style={{ padding: 12, borderColor: 'var(--hd-red)' }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        <InviteCard onInvited={refresh} />

        <div className="hd-card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <h2 className="hd-h2" style={{ margin: 0 }}>회원 목록</h2>
            <span style={{ flex: 1 }} />
            {loading && <span className="hd-meta">로딩…</span>}
            <button className="hd-btn sm" onClick={refresh} style={{ marginLeft: 8 }}>새로고침</button>
          </div>
          <table className="hd-table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>이메일</th>
                <th style={{ width: 140 }}>등급</th>
                <th style={{ width: 110 }}>비밀번호</th>
                <th style={{ width: 160 }}>마지막 로그인</th>
                <th style={{ width: 160 }}>초대자</th>
                <th style={{ width: 220 }}>역할 변경</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <MemberRowEl key={r.user_id} row={r} myId={me.sub} onChanged={refresh} />
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={6} className="hd-meta" style={{ textAlign: 'center', padding: 18 }}>없음</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function InviteCard({ onInvited }: { onInvited: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('regular');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null); setErr(null);
    try {
      const r = await inviteMember(email.trim(), role);
      setMsg(r.status === 're_invited' ? '이미 가입된 이메일 — 매직 링크 재발송' : '초대 메일 발송 완료');
      setEmail('');
      onInvited();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <div className="hd-card" style={{ padding: 18 }}>
      <h2 className="hd-h2" style={{ margin: 0, marginBottom: 8 }}>새 회원 초대</h2>
      <p className="hd-meta" style={{ marginBottom: 14 }}>
        이메일 등록과 동시에 매직 링크가 발송됩니다. 첫 로그인 시 비밀번호 설정 페이지로 자동 이동.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="email" required placeholder="user@hd.com"
          value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ ...inputStyle, flex: '1 1 280px', minWidth: 220 }}
          autoComplete="off"
        />
        <select
          value={role} onChange={(e) => setRole(e.target.value as UserRole)}
          style={{ ...inputStyle, width: 180 }}
        >
          <option value="regular">일반 (LLM·회원관리 접근 X)</option>
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
        <button type="submit" className="hd-btn primary" disabled={busy}>
          {busy ? '발송 중…' : '초대 발송'}
        </button>
      </form>
      {msg && <div className="hd-meta" style={{ marginTop: 10, color: 'var(--hd-green)' }}>{msg}</div>}
      {err && <div className="hd-meta" style={{ marginTop: 10, color: 'var(--hd-red)' }}>{err}</div>}
    </div>
  );
}

function MemberRowEl({ row, myId, onChanged }: { row: MemberRow; myId: string; onChanged: () => void }) {
  const [role, setRole] = useState<UserRole>(row.role);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isSelf = row.user_id === myId;

  async function save() {
    if (role === row.role) return;
    setBusy(true); setErr(null);
    try {
      await updateMemberRole(row.user_id, role);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setRole(row.role);
    } finally { setBusy(false); }
  }

  return (
    <tr>
      <td>{row.email}{isSelf && <span className="hd-meta"> · 본인</span>}</td>
      <td><span className={`hd-badge ${row.role === 'super_admin' ? 'green' : row.role === 'admin' ? 'blue' : 'ghost'}`}>{roleLabel[row.role]}</span></td>
      <td><span className={`hd-badge ${row.password_set ? 'green' : 'ghost'}`}>{row.password_set ? '설정됨' : '미설정'}</span></td>
      <td className="hd-num">{row.last_login_at ? new Date(row.last_login_at).toLocaleString('ko-KR') : '–'}</td>
      <td className="hd-meta">{row.invited_by_email ?? '–'}</td>
      <td>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <select
            value={role} onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={busy || isSelf}
            style={{ ...inputStyle, height: 28, flex: 1 }}
          >
            <option value="regular">일반</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <button
            className="hd-btn sm"
            onClick={save}
            disabled={busy || isSelf || role === row.role}
          >저장</button>
        </span>
        {err && <div className="hd-meta" style={{ color: 'var(--hd-red)', fontSize: 11 }}>{err}</div>}
      </td>
    </tr>
  );
}
