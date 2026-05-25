'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthGate } from '../../components/AuthGate';
import { TopBar } from '../../components/TopBar';
import { SectionNav } from '../../components/SectionNav';
import { getSupabase } from '@/lib/supabase';
import {
  getVoiceHeatmap,
  type HeatmapAxis,
  type HeatmapTier,
  type VoiceHeatmap,
  type VoiceHeatmapRow,
} from '@/lib/api';

const SEGMENT_LABEL: Record<string, { ko: string; en: string; ru: string }> = {
  individual:      { ko: '개인 사업자',     ru: 'Индивидуал.',    en: 'Individual'    },
  fleet_rental:    { ko: '플릿·렌탈',       ru: 'Парк/аренда',    en: 'Fleet/Rental'  },
  key_account:     { ko: '키 어카운트',     ru: 'Ключ. клиент',   en: 'Key Account'   },
  mining:          { ko: '광업',            ru: 'Горнодобыча',    en: 'Mining'        },
  infrastructure:  { ko: '인프라',          ru: 'Инфраструкт.',   en: 'Infrastructure'},
  agri_plantation: { ko: '농업·플랜.',      ru: 'С/х · план.',    en: 'Agri/Plant.'   },
  quarry:          { ko: '채석장',          ru: 'Карьер',         en: 'Quarry'        },
  gov_public:      { ko: '정부·공공',       ru: 'Гос. сектор',    en: 'Gov/Public'    },
};

const AXIS_LABEL: Record<HeatmapAxis, { ko: string; en: string; ru: string }> = {
  price:       { ko: '가격',     ru: 'Цена',      en: 'Price'       },
  fuel:        { ko: '연료',     ru: 'Топливо',   en: 'Fuel'        },
  durability:  { ko: '내구성',   ru: 'Надёжн.',   en: 'Durability'  },
  service:     { ko: '서비스',   ru: 'Сервис',    en: 'Service'     },
  reference:   { ko: '레퍼런스', ru: 'Реф.',      en: 'Reference'   },
  versatility: { ko: '다목적',   ru: 'Универс.',  en: 'Versatility' },
};

const AXES: HeatmapAxis[] = ['price', 'fuel', 'durability', 'service', 'reference', 'versatility'];

const TIER_BG: Record<HeatmapTier, string> = {
  primary:   'var(--hd-prosperity, #0B6E1E)',
  secondary: 'var(--hd-bright-green, #4FA663)',
  base:      'var(--hd-light-green, #C4DEC8)',
  none:      'var(--hd-steel-100, #EEF1F4)',
};
const TIER_FG: Record<HeatmapTier, string> = {
  primary:   '#FFFFFF',
  secondary: '#FFFFFF',
  base:      '#15301A',
  none:      '#8A9099',
};

export default function VoiceHeatmapPage() {
  return (
    <AuthGate>
      {({ session: s }) => <View email={s.user.email ?? ''} />}
    </AuthGate>
  );
}

function View({ email }: { email: string }) {
  const [filters, setFilters] = useState<{ from?: string; to?: string; event?: string }>({});
  const [data, setData] = useState<VoiceHeatmap | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchHeatmap = useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await getVoiceHeatmap(filters)); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [filters]);

  useEffect(() => { fetchHeatmap(); }, [fetchHeatmap]);
  const signOut = () => getSupabase().auth.signOut();

  // 최강·최약 segment-axis pair 산출.
  const extremes = useMemo(() => extractExtremes(data?.matrix ?? []), [data]);

  return (
    <>
      <TopBar lang={'ko'} email={email} onSignOut={signOut} />
      <SectionNav />

      <main style={{ padding: 18 }}>
        <h1 className="hd-h1" style={{ margin: '6px 0 6px' }}>HD건설기계 · CTT Heatmap</h1>
        <p className="hd-meta" style={{ margin: '0 0 14px' }}>
          8 segment × 6 axis · CTT Moscow 2026 · survey_v2_dealer_ctt · R_10.01 hd_strength_matrix + B-Q1·B-Q2·B-Q6 보강.
        </p>

        <div className="hd-card" style={{ marginBottom: 12, padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hd-eyebrow">기간</span>
          <input type="date" value={filters.from ?? ''}
            onChange={(e) => setFilters({ ...filters, from: e.target.value || undefined })}
            style={dateStyle()} />
          <span className="hd-meta">~</span>
          <input type="date" value={filters.to ?? ''}
            onChange={(e) => setFilters({ ...filters, to: e.target.value || undefined })}
            style={dateStyle()} />
          <span style={{ width: 1, height: 18, background: 'var(--hd-steel-200)' }} />
          <span className="hd-eyebrow">Event</span>
          <input type="text" placeholder="ctt_moscow_2026"
            value={filters.event ?? ''}
            onChange={(e) => setFilters({ ...filters, event: e.target.value || undefined })}
            style={dateStyle(200)} />
          <span style={{ marginLeft: 'auto' }} />
          <button className="hd-btn" onClick={fetchHeatmap} disabled={loading}>
            {loading ? '...' : '↻ Refresh'}
          </button>
        </div>

        {/* KPI strip */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <Kpi label="총 응답자" value={data ? String(data.totals.respondents) : '-'} />
          <Kpi label="최강 segment-axis"
               value={extremes.strong ? `${segLabel(extremes.strong.segment)} · ${AXIS_LABEL[extremes.strong.axis].ko} (${extremes.strong.avg})` : '-'} />
          <Kpi label="최약 segment-axis"
               value={extremes.weak ? `${segLabel(extremes.weak.segment)} · ${AXIS_LABEL[extremes.weak.axis].ko} (${extremes.weak.avg})` : '-'} />
        </div>

        {err && <div className="hd-card" style={{ padding: 12, color: '#B91C1C', marginBottom: 10 }}>{err}</div>}

        {/* Heatmap table */}
        <div className="hd-card" style={{ padding: 12, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 4, width: '100%', minWidth: 720 }}>
            <thead>
              <tr>
                <th style={headerCellStyle('left', 180)}>Segment</th>
                {AXES.map((a) => (
                  <th key={a} style={headerCellStyle('center')}>
                    <div style={{ fontWeight: 600 }}>{AXIS_LABEL[a].ko}</div>
                    <div className="hd-meta" style={{ fontSize: 10 }}>{AXIS_LABEL[a].ru}</div>
                  </th>
                ))}
                <th style={headerCellStyle('right', 70)}>n</th>
              </tr>
            </thead>
            <tbody>
              {(data?.matrix ?? []).map((row) => (
                <HeatmapRow key={row.segment} row={row} />
              ))}
              {!data && (
                <tr><td colSpan={AXES.length + 2} style={{ padding: 20, textAlign: 'center' }} className="hd-meta">
                  {loading ? 'Loading…' : '데이터 없음'}
                </td></tr>
              )}
            </tbody>
          </table>
          {data?.truncated && (
            <div className="hd-meta" style={{ marginTop: 8, fontSize: 11 }}>
              ⚠ 10,000건 초과 — 일부 응답이 누락됐을 수 있음. 기간 필터로 좁히세요.
            </div>
          )}
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, marginTop: 12, fontSize: 12, alignItems: 'center' }}>
          <span className="hd-meta">색상:</span>
          <LegendSwatch tier="primary"   label={`Primary (≥${data?.tier_thresholds.primary ?? 80})`} />
          <LegendSwatch tier="secondary" label={`Secondary (≥${data?.tier_thresholds.secondary ?? 50})`} />
          <LegendSwatch tier="base"      label={`Base (≥${data?.tier_thresholds.base ?? 30})`} />
          <LegendSwatch tier="none"      label={`None (<${data?.tier_thresholds.base ?? 30})`} />
        </div>
      </main>
    </>
  );
}

function HeatmapRow({ row }: { row: VoiceHeatmapRow }) {
  const known = !!SEGMENT_LABEL[row.segment];
  return (
    <tr>
      <td style={rowHeadStyle(known ? 'normal' : 'muted')}>
        <Link href={`/voice/responses?segment=${encodeURIComponent(row.segment)}`}
              style={{ color: 'inherit', textDecoration: 'none' }}>
          <div style={{ fontWeight: 600 }}>{segLabel(row.segment)}</div>
          <div className="hd-meta" style={{ fontSize: 10 }}>
            {SEGMENT_LABEL[row.segment]?.ru ?? row.segment}
          </div>
        </Link>
      </td>
      {AXES.map((axis) => {
        const cell = row.axes[axis];
        return (
          <td key={axis} style={{ padding: 0 }}>
            <Link
              href={`/voice/responses?segment=${encodeURIComponent(row.segment)}`}
              style={cellStyle(cell.tier)}
              title={`${segLabel(row.segment)} · ${AXIS_LABEL[axis].ko}: ${cell.avg} (n=${cell.n}, tier=${cell.tier})`}
            >
              <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {cell.n > 0 ? cell.avg : '-'}
              </div>
              <div style={{ fontSize: 10, opacity: 0.85 }}>n={cell.n}</div>
            </Link>
          </td>
        );
      })}
      <td style={{ padding: '6px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {row.respondents}
      </td>
    </tr>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="hd-card" style={{ padding: '8px 14px', minWidth: 180 }}>
      <div className="hd-eyebrow" style={{ fontSize: 10 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function LegendSwatch({ tier, label }: { tier: HeatmapTier; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block', width: 14, height: 14, borderRadius: 3,
        background: TIER_BG[tier], border: '1px solid var(--hd-steel-200, #ccd2d8)',
      }} />
      <span>{label}</span>
    </span>
  );
}

function extractExtremes(matrix: VoiceHeatmapRow[]) {
  let strong: { segment: string; axis: HeatmapAxis; avg: number } | null = null;
  let weak: { segment: string; axis: HeatmapAxis; avg: number } | null = null;
  for (const row of matrix) {
    for (const axis of AXES) {
      const c = row.axes[axis];
      if (c.n === 0) continue;
      if (!strong || c.avg > strong.avg) strong = { segment: row.segment, axis, avg: c.avg };
      if (!weak || c.avg < weak.avg) weak = { segment: row.segment, axis, avg: c.avg };
    }
  }
  return { strong, weak };
}

function segLabel(seg: string): string {
  return SEGMENT_LABEL[seg]?.ko ?? seg;
}

function headerCellStyle(align: 'left' | 'center' | 'right', minWidth?: number): React.CSSProperties {
  return {
    padding: '6px 10px', textAlign: align, fontSize: 11,
    color: 'var(--hd-gray, #5C6770)', fontWeight: 600,
    borderBottom: '1px solid var(--hd-steel-200, #ccd2d8)',
    minWidth: minWidth,
  };
}

function rowHeadStyle(variant: 'normal' | 'muted'): React.CSSProperties {
  return {
    padding: '8px 10px', verticalAlign: 'middle',
    background: variant === 'muted' ? 'var(--hd-steel-50, #F5F7F9)' : 'transparent',
    color: variant === 'muted' ? 'var(--hd-gray)' : 'var(--hd-ink, #002554)',
    borderRadius: 6,
  };
}

function cellStyle(tier: HeatmapTier): React.CSSProperties {
  return {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: 56, padding: '6px 4px', borderRadius: 6,
    background: TIER_BG[tier],
    color: TIER_FG[tier],
    textDecoration: 'none',
    fontVariantNumeric: 'tabular-nums',
    border: '1px solid rgba(0,0,0,0.05)',
  };
}

function dateStyle(width = 150): React.CSSProperties {
  return {
    height: 28, padding: '0 8px', font: 'inherit',
    border: 'var(--hd-border, 1px solid #ccd2d8)', borderRadius: 4,
    background: 'var(--hd-paper, #fff)', width,
  };
}
