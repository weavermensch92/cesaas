'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Lang } from '@hd/design/i18n';
import { AuthGate, isAdminRole } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  listMembers, inviteMember, updateMemberRole, deleteMember,
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

  const [showDeleted, setShowDeleted] = useState(false);
  const active = rows.filter((r) => !r.deleted_at);
  const deleted = rows.filter((r) => !!r.deleted_at);
  const visible = showDeleted ? rows : active;

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
            {deleted.length > 0 && (
              <label className="hd-meta" style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
                삭제된 회원 표시 ({deleted.length})
              </label>
            )}
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
                <th style={{ width: 260 }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <MemberRowEl key={r.user_id} row={r} myId={me.sub} onChanged={refresh} />
              ))}
              {!loading && visible.length === 0 && (
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
  const isDeleted = !!row.deleted_at;

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

  async function handleDelete() {
    if (!window.confirm(`${row.email} 회원을 삭제하시겠습니까?\nID는 보존되고 이메일·데이터는 익명화됩니다.`)) return;
    setBusy(true); setErr(null);
    try {
      await deleteMember(row.user_id);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const rowStyle: React.CSSProperties = isDeleted
    ? { opacity: 0.45, backgroundColor: 'var(--hd-surface)' }
    : {};

  return (
    <tr style={rowStyle}>
      <td>
        {row.email}
        {isSelf && <span className="hd-meta"> · 본인</span>}
        {isDeleted && <span className="hd-badge ghost" style={{ marginLeft: 6, fontSize: 10 }}>삭제됨</span>}
      </td>
      <td><span className={`hd-badge ${row.role === 'super_admin' ? 'green' : row.role === 'admin' ? 'blue' : 'ghost'}`}>{roleLabel[row.role]}</span></td>
      <td><span className={`hd-badge ${row.password_set ? 'green' : 'ghost'}`}>{row.password_set ? '설정됨' : '미설정'}</span></td>
      <td className="hd-num">{row.last_login_at ? new Date(row.last_login_at).toLocaleString('ko-KR') : '–'}</td>
      <td className="hd-meta">{row.invited_by_email ?? '–'}</td>
      <td>
        {isDeleted ? (
          <span className="hd-meta" style={{ fontSize: 11 }}>
            {new Date(row.deleted_at!).toLocaleString('ko-KR')} 삭제
          </span>
        ) : (
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
            <button
              className="hd-btn sm"
              onClick={handleDelete}
              disabled={busy || isSelf}
              style={{ color: 'var(--hd-red)', borderColor: 'var(--hd-red)' }}
            >삭제</button>
          </span>
        )}
        {err && <div className="hd-meta" style={{ color: 'var(--hd-red)', fontSize: 11 }}>{err}</div>}
      </td>
    </tr>
  );
}
