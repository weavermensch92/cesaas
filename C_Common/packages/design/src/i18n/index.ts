/**
 * i18n dictionary — Korean / Russian / English (en은 v1.1).
 * 원본: hd-hyundai-poc-harness-v1/hd-design/i18n.jsx
 *
 * 추가 키는 ko + ru 양쪽에 동시에 — README § 6 룰.
 * 모든 user-facing 문자열은 여기로. UI 컴포넌트는 tx(lang, key) 호출.
 */

export type Lang = 'ko' | 'ru';

const ko = {
  brand: 'HD건설기계',
  product: 'Sensor Admin',
  crumb_path: '러시아 채널 · CRM 자동 캡쳐',
  env_live: '러시아 4노드 정상',
  user_role: 'HD 마케팅팀',

  nav_overview: '대시보드',
  nav_captures: '캡쳐 목록',
  nav_clusters: 'EntityCluster',
  nav_normalize: '정규화 큐',
  nav_rules: '하네스 2 룰',
  nav_audit: '편집 이력',
  nav_definitions: 'CRM 정의',

  sub_all: '전체',
  sub_unreviewed: '미검토',
  sub_low_conf: '저신뢰 (<70%)',
  sub_edited: '편집됨',
  sub_failed: '실패·재시도',

  th_select: '',
  th_cluster: '클러스터',
  th_entity: 'Deal ID',
  th_dealer: '딜러',
  th_screens: '캡쳐',
  th_screen_kinds: '화면',
  th_lead: '리드 후보',
  th_score: 'Lead Score',
  th_conf: '평균 신뢰도',
  th_status: '상태',
  th_captured: '캡쳐 시각',
  th_actions: '',

  s_pending: '정규화 대기',
  s_running: '추출 중',
  s_review: '검토 필요',
  s_approved: '승인',
  s_edited: '수동 편집',
  s_failed: '실패',

  f_company: '회사명',
  f_contact: '담당자',
  f_phone: '연락처',
  f_email: '이메일',
  f_region: '지역',
  f_industry: '업종',
  f_model_interest: '관심 장비',
  f_qty: '예상 수량',
  f_budget: '예산',
  f_timeline: '구매 시점',
  f_funding: '자금 조달',
  f_stage: '단계',
  f_notes: '비고',

  btn_review: '검토',
  btn_edit: '수동 편집',
  btn_reextract: '재정규화',
  btn_approve: '승인',
  btn_open: '열기',
  btn_save: '저장',
  btn_cancel: '취소',
  btn_bulk: '일괄 재정규화',
  btn_export: '내보내기',
  btn_open_image: '이미지 5장 보기',
  btn_send_to_u: 'U_Unified로 보내기',

  sec_meta: '메타',
  sec_cluster: 'Entity Cluster · 캡쳐 5장',
  sec_normalized: '정규화 결과 · 13 필드',
  sec_audit: '편집 이력',
  sec_pipeline: '파이프라인 상태',
  confidence: '신뢰도',
  avg_conf: '평균 신뢰도',
  prompt_v: '프롬프트 버전',
  model: '모델',
  chunks: '청크',
  bytes: '용량',

  sk_deal_list: 'Deal List',
  sk_deal_detail: 'Deal Detail',
  sk_company: 'Company',
  sk_contact: 'Contact',
  sk_activity: 'Activity',
  sk_funnel: 'Funnel',
  sk_task: 'Task',

  ov_capture_24h: '24시간 캡쳐',
  ov_success: '캡쳐 성공률',
  ov_avg_lat: 'P95 캡쳐→DB',
  ov_normalize: '정규화 큐',
  ov_review_q: '검토 대기',
  ov_cycles: '정확도 사이클',

  tw_lang: '언어',
  tw_density: '정보 밀도',
  tw_dense: 'Dense',
  tw_balanced: 'Balanced',
  tw_spacious: 'Spacious',

  queue_msg: '5분 안에 LLM 정규화 시도',
  cluster_hint: '동일 deal entity_id로 자동 묶임',
  edit_diff: 'LLM 추출 ↔ HD 편집 차이',
  hot_reload: '룰 hot reload 완료',
  helper_search: '딜러·회사·deal id 검색',

  a_focus_capture: 'EntityCluster 자동 묶음 5장 → 1 deal',
} as const;

type Dict = { [K in keyof typeof ko]: string };

const ru: Dict = {
  brand: 'HD건설기계',
  product: 'Sensor Admin',
  crumb_path: 'Канал РФ · Авто-захват CRM',
  env_live: '4 узла РФ · норма',
  user_role: 'Маркетинг HD',

  nav_overview: 'Сводка',
  nav_captures: 'Захваты',
  nav_clusters: 'Кластеры сущностей',
  nav_normalize: 'Очередь LLM',
  nav_rules: 'Правила (Harness 2)',
  nav_audit: 'История правок',
  nav_definitions: 'CRM-определения',

  sub_all: 'Все',
  sub_unreviewed: 'Без проверки',
  sub_low_conf: 'Низкая увер. (<70%)',
  sub_edited: 'Отредактир.',
  sub_failed: 'Ошибки',

  th_select: '',
  th_cluster: 'Кластер',
  th_entity: 'ID сделки',
  th_dealer: 'Дилер',
  th_screens: 'Захваты',
  th_screen_kinds: 'Экраны',
  th_lead: 'Лид-кандидат',
  th_score: 'Lead Score',
  th_conf: 'Средн. увер.',
  th_status: 'Статус',
  th_captured: 'Время',
  th_actions: '',

  s_pending: 'В очереди',
  s_running: 'Извлечение',
  s_review: 'Нужна проверка',
  s_approved: 'Подтверждено',
  s_edited: 'Правка',
  s_failed: 'Ошибка',

  f_company: 'Компания',
  f_contact: 'Контакт',
  f_phone: 'Телефон',
  f_email: 'E-mail',
  f_region: 'Регион',
  f_industry: 'Отрасль',
  f_model_interest: 'Интерес. модель',
  f_qty: 'Кол-во',
  f_budget: 'Бюджет',
  f_timeline: 'Срок покупки',
  f_funding: 'Финансир.',
  f_stage: 'Стадия',
  f_notes: 'Примечания',

  btn_review: 'Проверить',
  btn_edit: 'Править',
  btn_reextract: 'Переизвлечь',
  btn_approve: 'Подтвердить',
  btn_open: 'Открыть',
  btn_save: 'Сохранить',
  btn_cancel: 'Отмена',
  btn_bulk: 'Пакетная',
  btn_export: 'Экспорт',
  btn_open_image: '5 кадров',
  btn_send_to_u: 'В U_Unified',

  sec_meta: 'Мета',
  sec_cluster: 'Кластер · 5 кадров',
  sec_normalized: 'Извлечено · 13 полей',
  sec_audit: 'История',
  sec_pipeline: 'Конвейер',
  confidence: 'Уверенность',
  avg_conf: 'Средн. увер.',
  prompt_v: 'Версия промпта',
  model: 'Модель',
  chunks: 'Чанки',
  bytes: 'Объём',

  sk_deal_list: 'Список сделок',
  sk_deal_detail: 'Сделка',
  sk_company: 'Компания',
  sk_contact: 'Контакт',
  sk_activity: 'Действие',
  sk_funnel: 'Воронка',
  sk_task: 'Задача',

  ov_capture_24h: 'Захватов / 24ч',
  ov_success: 'Успешность',
  ov_avg_lat: 'P95 захват→БД',
  ov_normalize: 'Очередь',
  ov_review_q: 'На проверке',
  ov_cycles: 'Циклы точности',

  tw_lang: 'Язык',
  tw_density: 'Плотность',
  tw_dense: 'Плотно',
  tw_balanced: 'Сред.',
  tw_spacious: 'Свободно',

  queue_msg: 'LLM-извлечение в течение 5 мин',
  cluster_hint: 'Авто-группировка по entity_id',
  edit_diff: 'LLM ↔ правка HD',
  hot_reload: 'Hot reload правил',
  helper_search: 'Поиск: дилер · компания · ID',

  a_focus_capture: 'Авто-группа 5 кадров → 1 сделка',
};

export const I18N = { ko, ru } as const satisfies Record<Lang, Dict>;

export type TxKey = keyof Dict;

/**
 * 언어별 사전 조회 — fallback: ko.
 *   tx('ko', 'nav_overview') → '대시보드'
 */
export function tx(lang: Lang, key: TxKey): string {
  return I18N[lang]?.[key] ?? I18N.ko[key];
}

/**
 * 한 언어의 사전을 lookup 함수로 — UI에서 `t('nav_overview')` 패턴.
 */
export function makeT(lang: Lang): (key: TxKey) => string {
  return (key) => tx(lang, key);
}
