import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';

const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function MoonIcon() {
  return (
    <svg {...iconProps}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  const navItems = [
    { to: '/', key: 'nav.home', end: true },
    { to: '/farmer', key: 'nav.farmer', end: false },
    { to: '/coordinator', key: 'nav.coordinator', end: false },
    { to: '/canal', key: 'nav.canal', end: false },
    { to: '/phone', key: 'nav.phone', end: false },
    { to: '/demo', key: 'nav.demo', end: false },
  ];

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        {t('a11y.skipToContent')}
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Link className="brand" to="/" onClick={() => setMenuOpen(false)}>
            {t('app.name')}
          </Link>
          <nav id="site-nav" className={`site-nav${menuOpen ? ' open' : ''}`} aria-label={t('a11y.mainNav')}>
            <div className="nav-inner">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  {t(item.key)}
                </NavLink>
              ))}
            </div>
          </nav>
          <div className="header-controls">
            <div className="lang-toggle" role="group" aria-label={t('a11y.toggleLanguage')}>
              <button type="button" aria-pressed={lang === 'en'} lang="en" onClick={() => setLang('en')}>
                {t('controls.langOptionEn')}
              </button>
              <button type="button" aria-pressed={lang === 'te'} lang="te" onClick={() => setLang('te')}>
                {t('controls.langOptionTe')}
              </button>
            </div>
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              aria-label={t('a11y.toggleTheme')}
              aria-pressed={theme === 'dark'}
              title={`${t('controls.themeLabel')}: ${theme === 'light' ? t('controls.themeDark') : t('controls.themeLight')}`}
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
            <button
              type="button"
              className="icon-btn menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="site-nav"
              aria-label={menuOpen ? t('a11y.closeMenu') : t('a11y.openMenu')}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="main-content">
        {children}
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <span>{t('footer.text')}</span>
        </div>
      </footer>
    </div>
  );
}
