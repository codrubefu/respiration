import { formatSeconds } from '../utils';
import './Screens.css';

interface SummaryScreenProps {
  rounds: number;
  breathsPerRound: number;
  recoverySeconds: number;
  retentions: number[];
  sessionDuration: number;
  bestRetention: number;
  onStartAgain: () => void;
  onGoToDashboard: () => void;
}

export function SummaryScreen({
  rounds,
  breathsPerRound,
  recoverySeconds,
  retentions,
  sessionDuration,
  bestRetention,
  onStartAgain,
  onGoToDashboard,
}: SummaryScreenProps) {
  return (
    <section className="screen">
      <div className="screen-copy">
        <h1 className="screen-title">Rezumat</h1>
        <p className="screen-subtitle">Sesiunea a fost salvată și poți porni imediat una nouă.</p>
      </div>

      <div className="stats-grid">
        <article className="stat-card">
          <div className="stat-card__value">{rounds}</div>
          <div className="stat-card__label">Runde</div>
        </article>
        <article className="stat-card">
          <div className="stat-card__value">{formatSeconds(sessionDuration)}</div>
          <div className="stat-card__label">Durată totală</div>
        </article>
        <article className="stat-card">
          <div className="stat-card__value">{formatSeconds(bestRetention)}</div>
          <div className="stat-card__label">Cea mai bună retenție</div>
        </article>
      </div>

      <article className="surface-card">
        <div className="surface-card__title">Setări folosite</div>
        <div className="summary-grid">
          <div className="summary-grid__item">
            <span>Respirații / rundă</span>
            <strong>{breathsPerRound}</strong>
          </div>
          <div className="summary-grid__item">
            <span>Recuperare</span>
            <strong>{recoverySeconds}s</strong>
          </div>
        </div>
      </article>

      <article className="surface-card">
        <div className="surface-card__title">Retenții pe runde</div>
        {retentions.length === 0 ? (
          <div className="empty-state">Nu există retenții înregistrate pentru această sesiune.</div>
        ) : (
          <div className="retention-strip retention-strip--summary">
            {retentions.map((retention, index) => (
              <div className="retention-strip__item" key={`${retention}-${index + 1}`}>
                <span>Runda {index + 1}</span>
                <strong>{formatSeconds(retention)}</strong>
              </div>
            ))}
          </div>
        )}
      </article>

      <div className="action-grid action-grid--summary">
        <button className="button button--primary" type="button" onClick={onStartAgain}>
          Pornește din nou
        </button>
        <button className="button button--secondary" type="button" onClick={onGoToDashboard}>
          Înapoi la dashboard
        </button>
      </div>
    </section>
  );
}