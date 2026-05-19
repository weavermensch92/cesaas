-- 022_seed_r10_07_dealer_output.sql
-- R_10.07_DealerOutput 을 DB rule_versions(active)로 시드.
-- C_Common/r_10_rules/R_10.07_DealerOutput.yaml 의 1.0 스냅샷.
--
-- Phase F.1 (V-009 서버 Playbook 갱신 흐름):
--   shared/lead_scoring.ts 가 이 룰을 load → segment lookup → dealer_outputs.weapons/pitch/models/next_action 채움.
--   이전: title만 INSERT, talking_points·pitch·models·next_action 모두 NULL.
--
-- 후속:
--   r20/bin/publish-rule.ts 로 추후 정정. 5분 캐시 TTL 내 자동 반영.

DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.07_DealerOutput',
    '2026-05-19.001',
    $yaml$rule_id: R_10.07_DealerOutput
version: 1
description: 'segment + priority별 Playbook (talking points·pitch examples·next action) + LeadPriority 템플릿'
harness: 2
v1_v2: v1
status: active
last_modified: '2026-05-19T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

playbook:
  mining:
    id: R_10.07.001_mining
    description: '광업 — 대형 굴착기 우선'
    title_ko: '광업 — 대형 굴착기 우선 제안'
    title_ru: 'Горнодобыча — экскаваторы'
    sales_weapons: ['TCO 5년 비교표', '광업 라인업 카탈로그 (≥70t)']
    related_models: ['HX480L-3', 'HX520L-3', 'HX600L-3']
    talking_points_ko:
      - '광산 가동율과 기존 장비 노후도 확인'
      - '연간 가동 시간으로 TCO 비교'
      - 'HD 광업 라인업 (~70t 이상) 카탈로그 동봉'
    talking_points_ru:
      - 'Уточнить простой и износ парка'
      - 'Сравнение TCO по часам в год'
      - 'Каталог HD горно (≥70t)'
    pitch_examples_ko:
      - '연간 가동 시간이 6,000h 이상이라면, 5년 TCO에서 HD가 평균 12% 우위입니다.'
    pitch_examples_ru:
      - 'При 6 000+ ч/год HD выгоднее на 12% в 5-летнем TCO.'
    next_action_template: '본사 KAM 동행 방문 일정 조율 → CRM Lead 단계 Negotiation으로'

  key_account:
    id: R_10.07.002_key_account
    description: '키 어카운트 — 본사 KAM 동행'
    title_ko: '키 어카운트 — 본사 동행 영업 제안'
    title_ru: 'Ключ. клиент — визит из HQ'
    sales_weapons: ['HQ KAM 동행 카드', '직거래 단가 시뮬레이션']
    related_models: ['HX480L-3', 'HL975A', 'HL980A']
    talking_points_ko:
      - 'HD 본사 KAM(Key Account Manager) 동행 방문 가능 여부 안내'
      - '50대+ 발주는 본사 직거래 단계로 escalate'
    talking_points_ru:
      - 'Визит KAM из HQ — обсуждение прямой сделки'
      - 'Эскалация 50+ ед. на корпоративные условия'
    pitch_examples_ko:
      - '50대 이상이면 HD 본사 KAM이 한국에서 직접 방문 가능합니다.'
    pitch_examples_ru:
      - 'Для 50+ ед. KAM HD приезжает напрямую из Кореи.'
    next_action_template: 'KAM 동행 일정 + 직거래 단가 견적 발송'

  construction_heavy:
    id: R_10.07.003_construction_heavy
    description: '대규모 건설 — 패키지 + 파이낸싱'
    title_ko: '대규모 건설 — 패키지 + 파이낸싱'
    title_ru: 'Крупное строит. — пакет + финанс.'
    sales_weapons: ['패키지 할인표', 'HD 파이낸싱 안내자료']
    related_models: ['HX300L-3', 'HX380L-3', 'HL955A']
    talking_points_ko:
      - '굴착기 + 휠로더 패키지 할인 적용 가능 여부'
      - 'HD 파이낸싱·리스 옵션 안내'
    talking_points_ru:
      - 'Пакет экскаватор + погрузчик — скидка'
      - 'Финансирование/лизинг HD'
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '패키지 견적 + 파이낸싱 시뮬레이션 송부'

  agriculture:
    id: R_10.07.004_agriculture
    description: '농업 — 시즌·렌탈'
    title_ko: '농업 — 시즌 가동·렌탈 옵션'
    title_ru: 'С/х — сезон/аренда'
    sales_weapons: ['시즌 렌탈 안내']
    related_models: ['HX130 LCR', 'HL940A']
    talking_points_ko: ['시즌별 가동 패턴 확인', '렌탈/구매 비교']
    talking_points_ru: ['Сезонные циклы', 'Аренда vs покупка']
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '시즌 가동 데이터 수집 → 렌탈 옵션 견적'

  forestry:
    id: R_10.07.005_forestry
    description: '임업 — 산림 사양·체인'
    title_ko: '임업 — 산림 사양·체인 옵션'
    title_ru: 'Лесное — лесной пакет'
    sales_weapons: ['산림 사양 옵션표']
    related_models: ['HX220L-3', 'HX260L-3']
    talking_points_ko: ['산림 옵션(가드·체인) 필요 여부']
    talking_points_ru: ['Лесные опции (защита, цепи)']
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '산림 사양 옵션 견적'

  general_construction:
    id: R_10.07.006_general_construction
    description: '일반 건설 — 중급 라인'
    title_ko: '일반 건설 — 중급 장비 카탈로그'
    title_ru: 'Общ. строит. — средний класс'
    sales_weapons: ['중급 라인 카탈로그']
    related_models: ['HX140L-3', 'HX220L-3']
    talking_points_ko: ['주력 작업 유형 확인', '중급 라인 적합도']
    talking_points_ru: ['Тип основных работ', 'Подходит средний класс']
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '중급 라인 카탈로그 송부'

  rental:
    id: R_10.07.007_rental
    description: '렌탈 — 유지보수 패키지'
    title_ko: '렌탈 — 유지보수 패키지'
    title_ru: 'Аренда — пакет ТО'
    sales_weapons: ['유지보수 패키지 안내']
    related_models: []
    talking_points_ko: ['fleet 운용 시간·유지보수 부담']
    talking_points_ru: ['Часы парка, нагрузка ТО']
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '유지보수 패키지 견적'

  other:
    id: R_10.07.008_other
    description: 'fallback — 추가 진단'
    title_ko: '추가 진단 필요'
    title_ru: 'Доп. диагностика'
    sales_weapons: []
    related_models: []
    talking_points_ko:
      - '추가 6 axis 후속 질문으로 segment 변별'
    talking_points_ru:
      - 'Уточнить 6 axis для сегментации'
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '추가 axis 설문 발송'

lead_priority_template:
  P1:
    id: R_10.07.101_p1
    label: 'P1 즉시'
    icon: 'siren'
    next_action: 'HD 본사 영업팀 즉시 연결'
    rationale_template: 'score≥85 + 의도 high → 본사 직접 매칭'
    cta_ko: '본사 영업팀 즉시 연결'
    cta_ru: 'Связь с HD HQ — немедленно'
  P2:
    id: R_10.07.102_p2
    label: 'P2 긴급'
    icon: 'flame'
    next_action: '24h 안에 follow-up'
    cta_ko: '24h 안에 follow-up'
    cta_ru: 'Follow-up в 24ч'
  P3:
    id: R_10.07.103_p3
    label: 'P3 표준'
    icon: 'arrow-right'
    next_action: '주간 nurture 캠페인'
    cta_ko: '주간 nurture 캠페인'
    cta_ru: 'Еженедельный nurture'
  P4:
    id: R_10.07.104_p4
    label: 'P4 저우선'
    icon: 'clock'
    next_action: '월간 nurture'
    cta_ko: '월간 nurture'
    cta_ru: 'Ежемесячный nurture'
  P5:
    id: R_10.07.105_p5
    label: 'P5 관망'
    icon: 'archive'
    next_action: 'CRM 상태만 갱신'
    cta_ko: 'CRM 상태만 갱신'
    cta_ru: 'Только обновить статус в CRM'

output_format:
  default: markdown
  language: ru
  language_fallback: [ru, en, ko]
$yaml$,
    NULL,
    'system_migration',
    '022 — R_10.07 초기 시드 (Phase F.1 — V-009 서버 Playbook 갱신 흐름)'
  );
END
$migration$;
