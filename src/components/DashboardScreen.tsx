import type { SessionRecord } from '../types';
import { formatSeconds } from '../utils';
import './Screens.css';

interface DashboardScreenProps {
  history: SessionRecord[];
  bestRetention: number;
  averageRetention: number;
  notice: string;
  safetyAccepted: boolean;
  wakeLockEnabled: boolean;
  onStartSession: () => void;
  onConfigure: () => void;
}

export function DashboardScreen({
  history,
  bestRetention,
  averageRetention,
  notice,
  safetyAccepted,
  wakeLockEnabled,
  onStartSession,
  onConfigure,
}: DashboardScreenProps) {
  return (
    <section className="screen">
      <div className="hero-card">
        <div className="hero-card__badge">{wakeLockEnabled ? 'Ecran activ' : 'Ecran normal'}</div>
        <div className="hero-card__eyebrow">Dashboard</div>
        <h1 className="screen-title">Respirație în 3 faze</h1>
        <p className="screen-subtitle">Pornește rapid o sesiune și vezi progresul acumulat.</p>
        {!safetyAccepted ? (
          <p className="screen-notice screen-notice--inline">
            Pentru primul start trebuie să confirmi instrucțiunile de siguranță din pagina de configurare.
          </p>
        ) : null}
        {notice ? <p className="screen-notice">{notice}</p> : null}
        <div className="action-grid">
          <button className="button button--primary" type="button" onClick={onStartSession}>
            Start sesiune
          </button>
          <button className="button button--secondary" type="button" onClick={onConfigure}>
            Configurare sesiune
          </button>
        </div>
      </div>

      <div className="stats-grid">
        <article className="stat-card">
          <div className="stat-card__value">{history.length}</div>
          <div className="stat-card__label">Sesiuni totale</div>
        </article>
        <article className="stat-card">
          <div className="stat-card__value">{formatSeconds(bestRetention)}</div>
          <div className="stat-card__label">Record retenție</div>
        </article>
        <article className="stat-card">
          <div className="stat-card__value">{formatSeconds(averageRetention)}</div>
          <div className="stat-card__label">Medie retenții</div>
        </article>
      </div>

      <article className="surface-card">
        <div className="surface-card__title">Ultimele sesiuni</div>
        {history.length === 0 ? (
          <div className="empty-state">Nu există sesiuni salvate încă.</div>
        ) : (
          <div className="history-list">
            {history.slice(0, 5).map((item) => (
              <div className="history-row" key={item.id}>
                <div className="history-row__title">{new Date(item.createdAt).toLocaleString()}</div>
                <div className="history-row__meta">Durată: {formatSeconds(item.totalDurationSeconds)}</div>
                <div className="history-row__meta">
                  Runde: {item.roundsCompleted} • Respirații: {item.breathsPerRound}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}