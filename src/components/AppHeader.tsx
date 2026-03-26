import './AppHeader.css';
import type { Screen, Settings } from '../types';

interface AppHeaderProps {
  currentScreen: Screen;
  theme: Settings['theme'];
  canInstall: boolean;
  isInstalled: boolean;
  showIosHint: boolean;
  onInstall: () => void;
  onNavigate: (screen: Screen) => void;
  onThemeChange: (theme: Settings['theme']) => void;
}

const navigationItems: Array<{ screen: Screen; label: string }> = [
  { screen: 'dashboard', label: 'Dashboard' },
  { screen: 'home', label: 'Configurare' },
  { screen: 'about', label: 'Despre' },
  { screen: 'history', label: 'Istoric' },
];

export function AppHeader({
  currentScreen,
  theme,
  canInstall,
  isInstalled,
  showIosHint,
  onInstall,
  onNavigate,
  onThemeChange,
}: AppHeaderProps) {
  const showNavigation = currentScreen !== 'session';

  return (
    <header className="app-header">
      <div className="app-header__top-row">
        <button className="app-header__brand" type="button" onClick={() => onNavigate('dashboard')}>
          <span className="app-header__brand-dot" aria-hidden="true" />
          <span>Respirație 3 faze: metoda Wim Hof</span>
        </button>

        <div className="app-header__actions">
          {(canInstall || showIosHint || isInstalled) ? (
            <button
              className={`app-header__install-button${isInstalled ? ' is-installed' : ''}`}
              type="button"
              onClick={onInstall}
              disabled={isInstalled}
            >
              {isInstalled ? 'Instalată' : showIosHint ? 'Instalare iPhone' : 'Instalează'}
            </button>
          ) : null}

          <label className="app-header__theme-toggle" aria-label="Schimbă tema">
            <span className="app-header__theme-icon" aria-hidden="true">
              {theme === 'dark' ? '🌙' : '☀️'}
            </span>
            <input
              checked={theme === 'light'}
              className="app-header__theme-input"
              type="checkbox"
              onChange={(event) => onThemeChange(event.target.checked ? 'light' : 'dark')}
            />
            <span className="app-header__theme-track">
              <span className="app-header__theme-thumb" />
            </span>
          </label>
        </div>
      </div>

      {showIosHint ? (
        <p className="app-header__install-hint">
          Pe iPhone deschide meniul Share din Safari si alege Add to Home Screen.
        </p>
      ) : null}

      {showNavigation ? (
        <nav className="app-header__nav" aria-label="Navigare principală">
          {navigationItems.map((item) => (
            <button
              key={item.screen}
              className={`app-header__nav-button${currentScreen === item.screen ? ' is-active' : ''}`}
              type="button"
              onClick={() => onNavigate(item.screen)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      ) : null}
    </header>
  );
}