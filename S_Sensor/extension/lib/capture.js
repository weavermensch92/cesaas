// lib/capture.js — WebP 캡쳐 + 메타 조립 (S_10.03).
// content.js에서 메타만 만들고 background에 'capture_request' 메시지 송신.

/**
 * 페이지 메타 수집 — content.js 컨텍스트에서 호출.
 * @param {{ crmId: string, dealerId: string }} ctx
 */
export function collectMeta(ctx) {
  return {
    crm_id: ctx.crmId,
    dealer_id: ctx.dealerId,
    url: location.href,
    url_path: location.pathname + location.search,
    captured_at: new Date().toISOString(),
    title: document.title,
    referrer: document.referrer,
    spa_enter_time: performance.now(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
  };
}

/**
 * Quality 하향 폴백 (500KB 초과 시).
 */
export function pickFallbackQuality(sizeKb, currentQ) {
  if (sizeKb <= 500) return null;
  if (currentQ >= 85) return 70;
  if (currentQ >= 70) return 50;
  return null;
}

export function estimateKb(dataUrl) {
  // base64 payload — 4글자당 3바이트.
  const comma = dataUrl.indexOf(',');
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.round((base64.length * 3) / 4 / 1024);
}
