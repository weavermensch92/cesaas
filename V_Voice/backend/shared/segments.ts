// 서버 측 R_10.05 segment 매칭 (보조).
// 클라이언트가 보낸 segment + 신뢰도를 우선 사용하되, 서버에서도 deterministic 재계산해 검증.
//
// 우선순위 순. 첫 매칭 적용. mining/key_account/construction_heavy는 axis 조건 강함.
//
// 주의: 이 파일은 R_10.05_Classification.yaml 의 voice_segment 룰을 *수동 미러* — 자동 로드 X.
// YAML 갱신 시 여기도 같이 수정. Phase D에서 lib.classifyVoiceSegment(axis) 호출로 교체 예정.
// (NF-P01 hot reload 정상 동작은 그때부터)

export type AxisData = {
  scale?: string | null;
  usage?: string | null;
  annual_operating_hours?: string | null;
  annual_deal_rub?: string | null;
  fleet_size?: string | null;
  decision_role?: string | null;
};

export interface SegmentResult {
  segment: string;
  confidence: number;
  method: 'server_rule';
}

const RULES: Array<{ segment: string; match: (a: AxisData) => boolean }> = [
  { segment: 'key_account',         match: (a) => a.annual_deal_rub === 'large' },
  { segment: 'mining',              match: (a) => a.usage === 'mining' && (a.scale === 'L' || a.scale === 'XL') },
  { segment: 'construction_heavy',  match: (a) => a.usage === 'construction_heavy' && ['M','L','XL'].includes(a.scale ?? '') },
  { segment: 'forestry',            match: (a) => a.usage === 'forestry' },
  { segment: 'agriculture',         match: (a) => a.usage === 'agriculture' },
  { segment: 'general_construction',match: (a) => a.usage === 'general_construction' },
  { segment: 'rental',              match: (a) => a.usage === 'rental' },
  { segment: 'other',               match: () => true },
];

export function classifyServerSide(a: AxisData): SegmentResult {
  for (const r of RULES) {
    if (r.match(a)) return { segment: r.segment, confidence: 1.0, method: 'server_rule' };
  }
  return { segment: 'other', confidence: 0.5, method: 'server_rule' };
}
