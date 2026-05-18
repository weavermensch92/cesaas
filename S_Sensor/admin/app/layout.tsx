import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'HD건설기계 · Sensor Admin',
  description: 'CRM 자동 캡쳐 결과 검토',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="hd-app" data-density="balanced">{children}</div>
      </body>
    </html>
  );
}
