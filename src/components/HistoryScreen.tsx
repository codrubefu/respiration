import type { SessionRecord } from '../types';
import { formatSeconds } from '../utils';
import './Screens.css';

interface HistoryScreenProps {
  history: SessionRecord[];
}

export function HistoryScreen({ history }: HistoryScreenProps) {
  return (
    <section className="screen">
      <div className="screen-copy">
        <h1 className="screen-title">Istoric sesiuni</h1>
        <p className="screen-subtitle">Vezi toate sesiunile completate și retențiile înregistrate.</p>
      </div>

      <article className="surface-card">
        <div className="surface-card__title">Toate sesiunile</div>

        {history.length === 0 ? (
          <div className="empty-state">Nu există sesiuni salvate încă.</div>
        ) : (
          <div className="history-list">
            {history.map((item) => (
              <div className="history-row" key={item.id}>
                <div className="history-row__title">{new Date(item.createdAt).toLocaleString()}</div>
                <div className="history-row__meta">Durată: {formatSeconds(item.totalDurationSeconds)}</div>
                <div className="history-row__meta">Runde: {item.roundsCompleted} / {item.roundsPlanned}</div>
                <div className="history-row__meta">Respirații: {item.breathsPerRound}</div>
                <div className="history-row__meta">
                  Max retenție: {formatSeconds(Math.max(...item.retentionTimes, 0))}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}