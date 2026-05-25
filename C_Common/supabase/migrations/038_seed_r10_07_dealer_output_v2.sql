-- 038_seed_r10_07_dealer_output_v2.sql
-- R_10.07 DealerOutput 을 CTT 8 segment 체계로 갱신 + axis_overrides 분기 도입.
--
-- 변경 요지 (vs 022):
--   1) playbook 8개 — individual / fleet_rental / key_account / mining /
--      infrastructure / agri_plantation / quarry / gov_public.
--   2) 신규 구조: playbook.<segment>.axis_overrides[axis_pair] — 응답자의 Top-2 axis 페어별
--      가산 weapons / pitch_examples_ko / pitch_examples_ru.
--      key 컨벤션: 알파벳 정렬한 두 axis '+' join. 예: 'durability+fuel', 'price+service'.
--   3) lead_priority_template 5종 (P1~P5) 보존.
--   4) output_format 보존.
--
-- 호출:
--   V_Voice/backend/shared/lead_scoring.ts 가 본 룰을 load → segment lookup → base weapons/pitch +
--   axis_overrides[sorted_pair] merge → dealer_outputs.weapons/pitch 채움.
--   lead_scoring.ts 변경은 Phase B에서 별도 진행. 본 마이그레이션은 YAML 시드만.
--
-- 출장 후 정정:
--   r20/bin/publish-rule.ts 로 hd_strength_matrix와 동일하게 hot reload. 5분 캐시 TTL.

DO $migration$
BEGIN
  PERFORM publish_rule(
    'R_10.07_DealerOutput',
    '2026-05-25.001',
    $yaml$rule_id: R_10.07_DealerOutput
version: 2
description: 'segment + Top-2 axis pair별 Playbook (talking points·pitch·next action) + LeadPriority 템플릿'
harness: 2
v1_v2: v2
status: active
last_modified: '2026-05-25T00:00:00Z'
modified_by: 'weaver@gridge.co.kr'

playbook:
  individual:
    id: R_10.07.001_individual
    description: '개인 사업자 — 가격·다목적 우선'
    title_ko: '개인 사업자 — 가격·금융 + 다목적 활용'
    title_ru: 'Индивидуальный предприниматель — цена + универсальность'
    sales_weapons: ['개인 사업자 리스 안내', '다목적 옵션 카탈로그']
    related_models: ['HX130 LCR', 'HX160L-3', 'HL940A']
    talking_points_ko:
      - '월 가동 시간·작업 유형 폭 확인'
      - '리스·할부 시 월 부담 시뮬레이션'
    talking_points_ru:
      - 'Часы/мес и спектр работ'
      - 'Расчёт ежемесячного платежа лизинг/рассрочка'
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '월 부담 견적 + 옵션 카탈로그 송부'
    axis_overrides:
      price+versatility:
        weapons: ['24개월 리스 시뮬레이션 카드', '다목적 어태치먼트 옵션표']
        pitch_examples_ko: ['리스 24개월 → 월 ₽X, 5종 어태치먼트 표준 패키지.']
        pitch_examples_ru: ['Лизинг 24 мес — ₽X/мес, 5 видов навесного в пакете.']
      fuel+price:
        weapons: ['연료비 절감 계산서']
        pitch_examples_ko: ['연 1,500h 가동 시 동급 대비 연료비 ₽Y 절감.']
        pitch_examples_ru: ['При 1 500 ч/год экономия топлива ₽Y.']

  fleet_rental:
    id: R_10.07.002_fleet_rental
    description: '플릿·렌탈 — 가동률·유지보수'
    title_ko: '플릿·렌탈 — 가동률·유지보수 패키지'
    title_ru: 'Парк/аренда — uptime + пакет ТО'
    sales_weapons: ['fleet 유지보수 패키지', '가동률 보장 계약 안내']
    related_models: ['HX220L-3', 'HX300L-3', 'HL955A']
    talking_points_ko:
      - 'fleet 규모·가동률 KPI'
      - '유지보수 SLA·부품 가용성'
    talking_points_ru:
      - 'Размер парка и KPI загрузки'
      - 'SLA ТО и доступность запчастей'
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: 'fleet 유지보수 SLA 견적 송부'
    axis_overrides:
      fuel+service:
        weapons: ['연료·서비스 통합 절감표']
        pitch_examples_ko: ['fleet 20대 기준 연료 ₽X + 다운타임 ₽Y 절감.']
        pitch_examples_ru: ['Парк 20 ед.: топливо ₽X + простой ₽Y экономия.']
      durability+service:
        weapons: ['5년 다운타임 통계']
        pitch_examples_ko: ['HD 동급 fleet 5년 평균 다운타임 8% 우위.']

  key_account:
    id: R_10.07.003_key_account
    description: '키 어카운트 — HQ KAM 동행'
    title_ko: '키 어카운트 — 본사 KAM 동행 + 직거래'
    title_ru: 'Ключ. клиент — KAM HQ + прямая сделка'
    sales_weapons: ['HQ KAM 동행 카드', '직거래 단가 시뮬레이션', '5년 TCO 비교표']
    related_models: ['HX480L-3', 'HX520L-3', 'HL975A', 'HL980A']
    talking_points_ko:
      - '본사 KAM 동행 방문 가능 여부'
      - '50대+ 발주 시 본사 직거래 escalate'
      - 'TCO 5년 비교 + 레퍼런스 사이트 투어'
    talking_points_ru:
      - 'Визит KAM из HQ'
      - 'Эскалация 50+ ед. на корпоративные условия'
      - 'TCO 5 лет + тур по объектам'
    pitch_examples_ko:
      - '50대 이상이면 HD 본사 KAM이 한국에서 직접 방문 가능합니다.'
    pitch_examples_ru:
      - 'Для 50+ ед. KAM HD приезжает напрямую из Кореи.'
    next_action_template: 'KAM 동행 일정 + 직거래 단가 견적'
    axis_overrides:
      reference+service:
        weapons: ['글로벌 KA 레퍼런스 30선', '러시아 내 서비스 거점 지도']
        pitch_examples_ko: ['Top-30 KA 레퍼런스 + 8개 거점 24h SLA.']
      durability+reference:
        weapons: ['10년 잔존가 분석서']

  mining:
    id: R_10.07.004_mining
    description: '광업 — 대형·내구성'
    title_ko: '광업 — 대형 굴착기 + 내구성 보증'
    title_ru: 'Горнодобыча — экскаваторы + надёжность'
    sales_weapons: ['TCO 5년 비교표', '광업 라인업 카탈로그 (≥70t)', '광산 레퍼런스 케이스']
    related_models: ['HX480L-3', 'HX520L-3', 'HX600L-3']
    talking_points_ko:
      - '광산 가동률·기존 장비 노후도'
      - '연간 가동 시간 → TCO 비교'
      - 'HD 광업 라인업 (~70t 이상) 카탈로그'
    talking_points_ru:
      - 'Простой и износ парка'
      - 'TCO по часам в год'
      - 'Каталог HD горно (≥70t)'
    pitch_examples_ko:
      - '연간 6,000h 이상이면 5년 TCO에서 HD가 평균 12% 우위.'
    pitch_examples_ru:
      - 'При 6 000+ ч/год HD выгоднее на 12% в 5-летнем TCO.'
    next_action_template: '본사 KAM 동행 + 광업 라인업 견적'
    axis_overrides:
      durability+fuel:
        weapons: ['광산 24/7 가동 내구성 보고서', '리터당 작업량 비교']
        pitch_examples_ko: ['24/7 가동 광산에서 HD 평균 가동률 92%.']
      durability+reference:
        weapons: ['러시아 광산 5개사 레퍼런스']

  infrastructure:
    id: R_10.07.005_infrastructure
    description: '인프라·대형 건설 — 패키지 + 레퍼런스'
    title_ko: '인프라·대형 건설 — 패키지 + 메가 프로젝트 레퍼런스'
    title_ru: 'Инфраструктура — пакет + мега-проекты'
    sales_weapons: ['패키지 할인표', '메가 프로젝트 레퍼런스', 'HD 파이낸싱 안내']
    related_models: ['HX300L-3', 'HX380L-3', 'HL955A', 'HL965A']
    talking_points_ko:
      - '굴착기 + 휠로더 패키지 할인 가능 여부'
      - 'HD 파이낸싱·리스 옵션'
      - '메가 프로젝트(고속도로·교량) 레퍼런스 사이트 동행'
    talking_points_ru:
      - 'Скидка на пакет экскаватор + погрузчик'
      - 'Финансирование/лизинг HD'
      - 'Тур по мега-объектам (дороги/мосты)'
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '패키지 견적 + 파이낸싱 시뮬레이션'
    axis_overrides:
      reference+durability:
        weapons: ['고속도로/교량/공항 레퍼런스 매트릭스']
        pitch_examples_ko: ['최근 3년 인프라 프로젝트 12건 레퍼런스.']
      service+durability:
        weapons: ['현장 상주 엔지니어 SLA']

  agri_plantation:
    id: R_10.07.006_agri_plantation
    description: '농업·플랜테이션 — 시즌 + 다목적'
    title_ko: '농업·플랜테이션 — 시즌 가동·다목적 옵션'
    title_ru: 'С/х · плантация — сезон + универсальность'
    sales_weapons: ['시즌 렌탈 안내', '다목적 어태치먼트 옵션표']
    related_models: ['HX130 LCR', 'HX160L-3', 'HL940A']
    talking_points_ko:
      - '시즌별 가동 패턴'
      - '다목적(농지·플랜테이션 조성) 어태치먼트 옵션'
      - '렌탈 vs 구매 비교'
    talking_points_ru:
      - 'Сезонные циклы'
      - 'Универсальные навески (поле/плантация)'
      - 'Аренда vs покупка'
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '시즌 가동 데이터 + 렌탈 옵션 견적'
    axis_overrides:
      versatility+price:
        weapons: ['5종 어태치먼트 패키지']
        pitch_examples_ko: ['굴착·정지·식재까지 1대로 — 5종 어태치먼트 표준.']
      fuel+price:
        weapons: ['시즌 연료비 추정표']

  quarry:
    id: R_10.07.007_quarry
    description: '채석장 — 내구성·연료'
    title_ko: '채석장 — 내구성·연료 효율'
    title_ru: 'Карьер — надёжность + топливо'
    sales_weapons: ['채석장 작업 사이클 분석', '연료 효율 비교표']
    related_models: ['HX300L-3', 'HX380L-3', 'HX480L-3', 'HL965A']
    talking_points_ko:
      - '작업 사이클(굴착·상차) 가혹도'
      - '리터당 작업량 비교'
      - 'undercarriage 내구성'
    talking_points_ru:
      - 'Цикл (выемка/погрузка) и тяжесть условий'
      - 'Работа на литр'
      - 'Износ ходовой'
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '작업 사이클 데이터 + 내구성 옵션 견적'
    axis_overrides:
      durability+fuel:
        weapons: ['undercarriage 강화 옵션', '연료 효율 톱-3 케이스']
        pitch_examples_ko: ['채석장 5년 가동 HD undercarriage 교체율 -18%.']

  gov_public:
    id: R_10.07.008_gov_public
    description: '정부·공공 — 서비스·레퍼런스'
    title_ko: '정부·공공 — 서비스 SLA + 공공 레퍼런스'
    title_ru: 'Гос. сектор — SLA сервис + ref'
    sales_weapons: ['공공조달 가이드', '서비스 SLA 카드', '공공 프로젝트 레퍼런스']
    related_models: ['HX220L-3', 'HX300L-3', 'HL955A']
    talking_points_ko:
      - '공공조달 입찰 일정·요건'
      - '서비스 SLA·부품 가용성'
      - '러시아 공공 프로젝트 레퍼런스'
    talking_points_ru:
      - 'Сроки и требования госзакупок'
      - 'SLA сервиса и запчасти'
      - 'Ref в гос. проектах РФ'
    pitch_examples_ko: []
    pitch_examples_ru: []
    next_action_template: '공공조달 일정 확인 + SLA 견적'
    axis_overrides:
      service+reference:
        weapons: ['공공 SLA 표준 계약서', '공공 프로젝트 10선']
        pitch_examples_ko: ['공공 표준 SLA 24h + 러시아 10개 프로젝트.']

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
    '038 — R_10.07 v2 — CTT 8 segment + axis_overrides[axis_pair] 분기 구조'
  );
END
$migration$;

-- ============================================================================
-- 검증
-- ============================================================================
DO $verify$
DECLARE
  _active_count INT;
BEGIN
  SELECT COUNT(*) INTO _active_count
    FROM rule_versions
    WHERE rule_id = 'R_10.07_DealerOutput' AND status = 'active' AND version = '2026-05-25.001';
  IF _active_count != 1 THEN
    RAISE EXCEPTION '038 verification failed: R_10.07 v2 active count = % (expected 1)', _active_count;
  END IF;
END
$verify$;
