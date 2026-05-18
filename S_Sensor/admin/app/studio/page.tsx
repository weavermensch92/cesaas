'use client';
import { useState } from 'react';
import type { Lang } from '@hd/design/i18n';
import { makeT } from '@hd/design/i18n';
import { AuthGate } from '../components/AuthGate';
import { TopBar } from '../components/TopBar';
import { SectionNav } from '../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  studioBuildSurvey,
  studioDeploy,
  type StudioQuestion,
  type StudioSurveySpec,
} from '@/lib/api';

const LANG: Lang = 'ko';

const EXAMPLES = [
  '러시아 광업(mining) 대형 사업자 대상 31문항 dealer 설문. 6 axis + 마케팅 7질문 + NPS + 동의. 광업 특유의 가동시간·디젤 가격·환경 규제 질문 추가.',
  '농업 보조 장비 visitor PWA 18문항. 핵심 axis 4 + 마케팅 5 + NPS + 동의 필수. 연락처는 옵트인. 농업 사업자에게 친숙한 어휘로.',
  '렌탈 사업자(rental) 인터뷰 dealer 25문항. 가동률·정비 비용·대체기 보유에 집중.',
];

export default function StudioPage() {
  return (
    <AuthGate>
      {(session) => <View email={session.user.email ?? ''} />}
    </AuthGate>
  );
}

interface BuildState {
  draft_id: string;
  spec: StudioSurveySpec;
  model: string;
  rule_version: string;
  prompt_version: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

function View({ email }: { email: string }) {
  const t = makeT(LANG);
  const [text, setText] = useState('');
  const [target, setTarget] = useState<'dealer' | 'visitor'>('dealer');
  const [archivePrev, setArchivePrev] = useState(true);
  const [building, setBuilding] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [build, setBuild] = useState<BuildState | null>(null);
  const [deployed, setDeployed] = useState<{ survey_id: string; target: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const signOut = () => getSupabase().auth.signOut();

  async function onBuild() {
    setBuilding(true); setErr(null); setDeployed(null);
    try {
      const r = await studioBuildSurvey({ input_text: text, target_audience: target, language: 'ko' });
      setBuild(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBuilding(false); }
  }

  async function onDeploy() {
    if (!build) return;
    setDeploying(true); setErr(null);
    try {
      const r = await studioDeploy({
        spec: build.spec, target, draft_id: build.draft_id, archive_previous: archivePrev,
      });
      setDeployed({ survey_id: r.survey_id, target: r.target });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setDeploying(false); }
  }

  function updateQ(i: number, patch: Partial<StudioQuestion>) {
    if (!build) return;
    const next = { ...build.spec, questions: build.spec.questions.map((q, idx) => idx === i ? { ...q, ...patch } : q) };
    setBuild({ ...build, spec: next });
  }
  function removeQ(i: number) {
    if (!build) return;
    const next = { ...build.spec, questions: build.spec.questions.filter((_, idx) => idx !== i) };
    setBuild({ ...build, spec: next });
  }
  function moveQ(i: number, dir: -1 | 1) {
    if (!build) return;
    const arr = [...build.spec.questions];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    setBuild({ ...build, spec: { ...build.spec, questions: arr } });
  }

  return (
    <>
      <TopBar lang={LANG} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <h1 className="hd-h1" style={{ margin: '6px 0 6px' }}>Studio · V_60</h1>
        <p className="hd-meta" style={{ margin: '0 0 14px' }}>
          자연어 → 설문 빌드 → 검토·편집 → 배포. R_10.08 SurveyBuildPrompt 사용 · gridge_admin 전용.
        </p>

        {err && (
          <div className="hd-card" style={{ padding: 10, marginBottom: 12 }}>
            <span className="hd-meta" style={{ color: 'var(--hd-red)' }}>오류: {err}</span>
          </div>
        )}

        {deployed && (
          <div className="hd-card" style={{ padding: 14, marginBottom: 14, background: '#e8f7eb', borderColor: 'var(--hd-heritage)' }}>
            <strong style={{ color: 'var(--hd-prosperity)' }}>✓ 배포 완료</strong>
            <div className="hd-meta" style={{ marginTop: 4 }}>
              <code style={codeStyle()}>survey_id: {deployed.survey_id}</code> · target {deployed.target}
            </div>
          </div>
        )}

        {/* 1) 자연어 입력 */}
        <section className="hd-card" style={{ marginBottom: 14 }}>
          <div className="hd-card-hd"><span className="hd-card-title">1. 자연어 입력</span></div>
          <div style={{ padding: 14 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="hd-eyebrow">Target</span>
              <span className={`hd-snav ${target === 'dealer' ? 'active' : ''}`}
                onClick={() => setTarget('dealer')} style={chipStyle}>Dealer (31)</span>
              <span className={`hd-snav ${target === 'visitor' ? 'active' : ''}`}
                onClick={() => setTarget('visitor')} style={chipStyle}>Visitor (18)</span>

              <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)' }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input type="checkbox" checked={archivePrev} onChange={(e) => setArchivePrev(e.target.checked)} />
                이전 active 자동 archive
              </label>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="예: 러시아 광업 대형 사업자 대상 31문항 dealer 설문..."
              style={{
                width: '100%', minHeight: 120, padding: 12,
                border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)',
                font: 'inherit', fontSize: 14, resize: 'vertical',
              }}
            />

            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <span className="hd-eyebrow" style={{ alignSelf: 'center', marginRight: 4 }}>예시</span>
              {EXAMPLES.map((ex, i) => (
                <button key={i} className="hd-btn sm ghost" onClick={() => setText(ex)} style={{ fontSize: 11, color: 'var(--hd-discovery)' }}>
                  {ex.slice(0, 40)}…
                </button>
              ))}
            </div>

            <div style={{ marginTop: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="hd-btn primary" onClick={onBuild} disabled={building || text.length < 8}>
                {building ? '빌드 중… (10~25s)' : 'LLM 빌드'}
              </button>
              <span className="hd-meta">{text.length}/4000자</span>
            </div>
          </div>
        </section>

        {/* 2) 검토·편집 */}
        {build && (
          <section className="hd-card" style={{ marginBottom: 14 }}>
            <div className="hd-card-hd">
              <span className="hd-card-title">2. 검토·편집</span>
              <span className="hd-card-sub">{build.spec.questions.length}문항 · {build.model} · prompt {build.prompt_version ?? '–'} · tokens {build.usage.input_tokens}/{build.usage.output_tokens}</span>
            </div>

            <div style={{ padding: 14 }}>
              <input
                value={build.spec.title}
                onChange={(e) => setBuild({ ...build, spec: { ...build.spec, title: e.target.value } })}
                style={{ width: '100%', padding: 10, font: '600 16px var(--hd-font-display)', color: 'var(--hd-trust)', border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)' }}
              />

              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="hd-eyebrow">language_default</span>
                <select
                  value={build.spec.language_default ?? 'ru'}
                  onChange={(e) => setBuild({ ...build, spec: { ...build.spec, language_default: e.target.value as 'ru' | 'en' | 'ko' } })}
                  style={selectStyle}
                >
                  <option value="ru">ru</option>
                  <option value="en">en</option>
                  <option value="ko">ko</option>
                </select>
                <span className="hd-eyebrow">estimated_minutes</span>
                <input
                  type="number" min={1} max={60}
                  value={build.spec.estimated_minutes ?? ''}
                  onChange={(e) => setBuild({ ...build, spec: { ...build.spec, estimated_minutes: e.target.value === '' ? undefined : Number(e.target.value) } })}
                  style={{ ...selectStyle, width: 60 }}
                />
              </div>

              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {build.spec.questions.map((q, i) => (
                  <QuestionRow key={i} q={q} index={i}
                    onPatch={(p) => updateQ(i, p)}
                    onRemove={() => removeQ(i)}
                    onUp={() => moveQ(i, -1)}
                    onDown={() => moveQ(i, 1)}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 3) 배포 */}
        {build && (
          <section className="hd-card">
            <div className="hd-card-hd"><span className="hd-card-title">3. 배포</span></div>
            <div style={{ padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="hd-meta">
                surveys + survey_questions 트랜잭션 INSERT · 새 survey_id 자동 발급
                {archivePrev && ' · 이전 active 같은 target archive'}
              </span>
              <span style={{ marginLeft: 'auto' }} />
              <button className="hd-btn accent" onClick={onDeploy} disabled={deploying}>
                {deploying ? '배포 중…' : `${target} 로 배포`}
              </button>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function QuestionRow({ q, index, onPatch, onRemove, onUp, onDown }: {
  q: StudioQuestion;
  index: number;
  onPatch: (p: Partial<StudioQuestion>) => void;
  onRemove: () => void;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '32px 1fr 130px 90px auto',
      gap: 8, alignItems: 'center',
      padding: 10, border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)', background: '#fff',
    }}>
      <span className="hd-num" style={{ textAlign:'center', color:'var(--hd-trust)', fontWeight:600 }}>{index + 1}</span>
      <input
        value={q.title_ko ?? q.title_ru ?? ''}
        onChange={(e) => onPatch({ title_ko: e.target.value, title_ru: q.title_ru ?? e.target.value })}
        placeholder="문항 제목 (ko)"
        style={{ height: 30, padding: '0 8px', border: 'var(--hd-border)', borderRadius: 'var(--hd-radius)', font: 'inherit', fontSize: 13 }}
      />
      <select
        value={q.type}
        onChange={(e) => onPatch({ type: e.target.value as StudioQuestion['type'] })}
        style={{ ...selectStyle, width: '100%' }}
      >
        <option value="single_select">single_select</option>
        <option value="multi_select">multi_select</option>
        <option value="scale_1_5">scale_1_5</option>
        <option value="scale_1_10">scale_1_10</option>
        <option value="nps">nps</option>
        <option value="text_short">text_short</option>
        <option value="text_long">text_long</option>
        <option value="number">number</option>
        <option value="slider">slider</option>
        <option value="consent">consent</option>
      </select>
      <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:12 }}>
        <input type="checkbox" checked={q.required ?? true} onChange={(e) => onPatch({ required: e.target.checked })} />
        required
      </label>
      <div style={{ display:'flex', gap:4 }}>
        <button className="hd-btn ghost sm" onClick={onUp}>↑</button>
        <button className="hd-btn ghost sm" onClick={onDown}>↓</button>
        <button className="hd-btn ghost sm" onClick={onRemove} style={{ color:'var(--hd-red)' }}>×</button>
      </div>
      {q.options && q.options.length > 0 && (
        <div style={{ gridColumn:'2 / -1', marginTop: 4 }}>
          <span className="hd-meta">options: </span>
          <span className="hd-meta" style={{ color:'var(--hd-trust)' }}>
            {q.options.map((o) => o.label_ko ?? o.label_ru).filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
      {q.axis && (
        <div style={{ gridColumn:'2 / -1' }}>
          <span className="hd-badge accent">axis: {q.axis}</span>
        </div>
      )}
    </div>
  );
}

const chipStyle: React.CSSProperties = { cursor: 'pointer', padding: '4px 10px', fontSize: 12 };
const selectStyle: React.CSSProperties = {
  height: 28, padding: '0 8px', border: 'var(--hd-border)',
  borderRadius: 'var(--hd-radius)', font: 'inherit', fontSize: 12, background: '#fff',
};
const codeStyle = (): React.CSSProperties => ({
  background: 'var(--hd-steel-50)', padding: '2px 6px', borderRadius: 4,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 12,
});
