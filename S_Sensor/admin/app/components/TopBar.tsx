'use client';
import { type Lang, makeT } from '@hd/design/i18n';

export function TopBar({ lang, email, onSignOut }: { lang: Lang; email?: string; onSignOut?: () => void }) {
  const t = makeT(lang);
  return (
    <header className="hd-topbar">
      <span className="hd-logo">
        <span className="hd-logo-mark">H</span>
        {t('brand')} · {t('product')}
      </span>
      <span className="hd-crumb">{t('crumb_path')}</span>
      <span className="hd-spacer" />
      {email && (
        <span className="hd-user">
          <span className="hd-avatar">{email.slice(0, 1).toUpperCase()}</span>
          {email}
        </span>
      )}
      {onSignOut && (
        <button className="hd-btn sm" onClick={onSignOut}>Sign out</button>
      )}
    </header>
  );
}
