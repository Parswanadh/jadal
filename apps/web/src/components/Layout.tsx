import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useI18n } from '../i18n/I18nContext';
import { useTheme } from '../theme/ThemeContext';

export default function Layout({ children }: { children: React.ReactNode }) {
  const { t, lang, toggleLang } = useI18n();
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
            <span className="brand-name">{t('app.name')}</span>
            <span className="brand-tagline">{t('app.tagline')}</span>
          </Link>
          <div className="header-controls">
            <button
              type="button"
              className="control-btn"
              onClick={toggleLang}
              aria-label={t('a11y.toggleLanguage')}
              title={`${t('controls.languageLabel')}: ${lang === 'en' ? t('controls.languageTelugu') : t('controls.languageEnglish')}`}
            >
              {lang === 'en' ? t('controls.switchToTelugu') : t('controls.switchToEnglish')}
            </button>
            <button
              type="button"
              className="control-btn"
              onClick={toggleTheme}
              aria-label={t('a11y.toggleTheme')}
              aria-pressed={theme === 'dark'}
              title={`${t('controls.themeLabel')}: ${theme === 'light' ? t('controls.themeDark') : t('controls.themeLight')}`}
            >
              {theme === 'light' ? t('controls.themeDark') : t('controls.themeLight')}
            </button>
            <button
              type="button"
              className="control-btn menu-btn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-label={menuOpen ? t('a11y.closeMenu') : t('a11y.openMenu')}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>
        <nav className={`site-nav${menuOpen ? ' open' : ''}`} aria-label={t('a11y.mainNav')}>
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
