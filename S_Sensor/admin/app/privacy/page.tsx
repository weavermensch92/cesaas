import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '개인정보 처리방침 · HD건설기계 Sensor',
  description: 'HD건설기계 Sensor Chrome 확장 프로그램 개인정보 처리방침',
};

export default function PrivacyPage() {
  return (
    <div style={{
      maxWidth: 820, margin: '0 auto', padding: '40px 24px 60px',
      font: '14px/1.7 "Noto Sans KR", "Malgun Gothic", -apple-system, sans-serif',
      color: '#002554',
    }}>
      <header style={{ borderBottom: '2px solid #00AD1D', paddingBottom: 16, marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{
            width: 32, height: 32, background: '#00AD1D', color: '#fff',
            borderRadius: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 16, fontWeight: 800,
          }}>H</span>
          <span style={{ fontSize: 13, color: '#63666A', letterSpacing: '0.04em' }}>HD건설기계 · 영업 데이터 PoC</span>
        </div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: '#00AD1D' }}>개인정보 처리방침</h1>
        <p style={{ fontSize: 12.5, color: '#63666A', margin: '6px 0 0' }}>
          최종 갱신: 2026-05-20 · 적용 대상: HD건설기계 Sensor Chrome 확장 프로그램
        </p>
      </header>

      <section style={{ marginBottom: 28 }}>
        <h2 style={H2}>1. 처리 목적</h2>
        <p>
          HD건설기계 Sensor 확장 프로그램(이하 "본 프로그램")은 HD건설기계 PoC(Proof of Concept) 내부 검증을 위해
          영업 담당자가 사용하는 CRM 화면을 자동 캡쳐하여, HD건설기계 영업 데이터 자동화 파이프라인에 안전하게 전송하는 것을
          유일한 목적으로 합니다. 본 프로그램은 일반 사용자가 아닌 <b>HD건설기계 및 협력 딜러의 영업 담당자</b> 만을 대상으로 합니다.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={H2}>2. 수집·처리 항목</h2>
        <table style={TBL}>
          <thead>
            <tr><th style={TH}>구분</th><th style={TH}>항목</th><th style={TH}>비고</th></tr>
          </thead>
          <tbody>
            <tr><td style={TD}>화면 이미지</td><td style={TD}>Bitrix24 CRM 화면(WebP)</td><td style={TD}>전송 직전 HMAC 서명, 16KB 청크 분할</td></tr>
            <tr><td style={TD}>화면 메타</td><td style={TD}>URL 경로, 캡쳐 시각, 뷰포트 크기, dealer_id</td><td style={TD}>이미지 합성 식별용</td></tr>
            <tr><td style={TD}>자격증명</td><td style={TD}>API_KEY_ID, HMAC_SECRET, DEALER_ID, API_BASE</td><td style={TD}>로컬 chrome.storage 에만 저장. 외부 전송 안 함</td></tr>
            <tr><td style={TD}>오프라인 큐</td><td style={TD}>송출 대기 캡쳐 (IndexedDB)</td><td style={TD}>전송 성공 시 자동 제거</td></tr>
          </tbody>
        </table>
        <p style={{ marginTop: 12 }}>
          <b>개인을 식별할 수 있는 외부 사용자 정보(이름·이메일·연락처·계정 PW 등)는 별도로 수집하지 않습니다.</b>
          CRM 화면 안에 포함된 고객 정보는 이미지의 일부로 함께 캡쳐될 수 있으며, 이는 HD건설기계가 영업 활동의 일환으로
          이미 보유 중인 자료에 한합니다.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={H2}>3. 수집 시점·방법</h2>
        <ul style={UL}>
          <li>딜러가 본인의 Chrome 으로 Bitrix24 CRM 페이지를 열었을 때 (`bitrix24.com` · `bitrix24.ru` · `bitrix.gkcompany.pro` 도메인 한정)</li>
          <li>해당 페이지 URL 패턴이 `crm/*` 으로 매칭될 때만 캡쳐 트리거</li>
          <li>비-CRM 페이지 (예: 일반 웹사이트·메일·은행) 는 캡쳐하지 않습니다 — manifest host_permissions 가 도메인을 제한</li>
          <li>각 캡쳐는 한국 서버(Supabase Tokyo)로 HMAC 서명된 HTTPS 로 전송</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={H2}>4. 보관 기간</h2>
        <ul style={UL}>
          <li><b>30일</b> 후 자동 삭제 (Supabase pg_cron `delete_old_captures` — 매일 03:00 KST)</li>
          <li>이미지 원본 + 데이터베이스 레코드 동시 hard delete</li>
          <li>정규화된 13 필드(이미지에서 LLM 추출) 도 동일 30일 정책 적용</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={H2}>5. 제3자 제공</h2>
        <p>
          제3자에게 제공하지 않습니다. 다만 캡쳐 이미지의 13 필드 추출을 위해 <b>Anthropic Claude API</b> 를
          호출하며(한국 서버 → Anthropic), 이는 HD건설기계 영업 데이터 처리를 위해 위탁하는 서비스입니다.
          Anthropic 의 데이터 처리 정책은 <a href="https://www.anthropic.com/legal/privacy" style={LINK}>anthropic.com/legal/privacy</a> 를 참고하세요.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={H2}>6. 사용자 권리·제어</h2>
        <ul style={UL}>
          <li><b>설치 거부</b>: 확장 프로그램을 설치하지 않으면 어떠한 데이터도 수집되지 않습니다</li>
          <li><b>일시 중지</b>: Chrome `chrome://extensions` 에서 비활성화</li>
          <li><b>완전 제거</b>: 동일 페이지에서 "삭제" — 로컬 chrome.storage / IndexedDB 큐도 함께 삭제</li>
          <li><b>키 폐기 요청</b>: HD건설기계 어드민에게 dealer_id 폐기 요청 시 서버 측 키 즉시 무효화</li>
          <li><b>이력 조회/삭제 요청</b>: 이메일 <a href="mailto:weaver.jeong@gmail.com" style={LINK}>weaver.jeong@gmail.com</a> 로 dealer_id 와 함께 요청 시 즉시 처리</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={H2}>7. 보안 조치</h2>
        <ul style={UL}>
          <li>HTTPS (TLS 1.3) 만 사용. 캡쳐 청크에 HMAC-SHA256 서명 + nonce(5분 TTL)</li>
          <li>자격증명 (HMAC secret) 은 로컬 chrome.storage 에만 저장 — 코드에 임베드되지 않음</li>
          <li>서버: Supabase Row Level Security · service_role 만 캡쳐 데이터 접근</li>
          <li>접근 감사: 모든 어드민 편집은 `normalize_audit` 테이블에 기록</li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={H2}>8. 문의처</h2>
        <p>
          개인정보 보호 책임자: Gridge weaver (HD건설기계 영업 데이터 PoC 위탁 운영)<br/>
          이메일: <a href="mailto:weaver.jeong@gmail.com" style={LINK}>weaver.jeong@gmail.com</a><br/>
          소속 도메인: hd-poc-admin.fly.dev
        </p>
      </section>

      <footer style={{ borderTop: '1px solid #d6dadf', paddingTop: 16, marginTop: 36, fontSize: 12, color: '#63666A' }}>
        본 처리방침은 PoC 종료(2026-05-31 예정) 이후에도 30일 보관 기간이 지난 데이터가 삭제될 때까지 유효합니다.
        주요 변경 사항은 본 페이지 상단의 "최종 갱신" 일자로 고지합니다.
      </footer>
    </div>
  );
}

const H2: React.CSSProperties = { fontSize: 17, fontWeight: 700, color: '#002554', borderLeft: '3px solid #00AD1D', paddingLeft: 10, margin: '0 0 12px' };
const UL: React.CSSProperties = { paddingLeft: 22, margin: 0 };
const TBL: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 };
const TH: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', background: '#f3f5f7', borderBottom: '1px solid #d6dadf', fontWeight: 600 };
const TD: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #e9edf0', verticalAlign: 'top' };
const LINK: React.CSSProperties = { color: '#003087', textDecoration: 'underline' };
