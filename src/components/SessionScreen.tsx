import { PHASES } from '../constants';
import type { Phase, Settings } from '../types';
import { formatSeconds } from '../utils';
import { BreathCircle } from './BreathCircle';
import './Screens.css';

interface SessionScreenProps {
  phase: Phase;
  phaseTitle: string;
  currentInstruction: string;
  inhale: boolean;
  recoveryProgress: number;
  breathingDuration: number;
  breathCount: number;
  breathsPerRound: number;
  round: number;
  totalRounds: number;
  holdSeconds: number;
  recoverySecondsLeft: number;
  retentions: number[];
  settings: Settings;
  notice: string;
  onSkipToHold: () => void;
  onFinishHold: () => void;
  onPauseSession: () => void;
  onResumeSession: () => void;
  onCancelSession: () => void;
}

export function SessionScreen({
  phase,
  phaseTitle,
  currentInstruction,
  inhale,
  recoveryProgress,
  breathingDuration,
  breathCount,
  breathsPerRound,
  round,
  totalRounds,
  holdSeconds,
  recoverySecondsLeft,
  retentions,
  settings,
  notice,
  onSkipToHold,
  onFinishHold,
  onPauseSession,
  onResumeSession,
  onCancelSession,
}: SessionScreenProps) {
  return (
    <section className="screen screen--session">
      <div className="session-panel">
        <div className="session-panel__meta">
          <div>
            <div className="session-panel__eyebrow">Runda {round} / {totalRounds}</div>
            <h1 className="screen-title screen-title--compact">{phaseTitle}</h1>
          </div>
          <div className="session-phase-chip">{currentInstruction}</div>
        </div>

        {notice ? <p className="screen-notice">{notice}</p> : null}

        <BreathCircle
          breathCount={breathCount}
          breathsPerRound={breathsPerRound}
          breathingDuration={breathingDuration}
          inhale={inhale}
          phase={phase}
          recoveryProgress={recoveryProgress}
        />

        <div className="session-metrics">
          <article className="session-metric-card">
            <div className="session-metric-card__label">Instrucțiune</div>
            <div className="session-metric-card__value">{currentInstruction}</div>
          </article>

          <article className="session-metric-card">
            <div className="session-metric-card__label">Respirații</div>
            <div className="session-metric-card__value">{breathCount} / {breathsPerRound}</div>
          </article>

          {phase === PHASES.HOLD && settings.showHoldTimer ? (
            <article className="session-metric-card">
              <div className="session-metric-card__label">Retenție</div>
              <div className="session-metric-card__value">{formatSeconds(holdSeconds)}</div>
            </article>
          ) : null}

          {phase === PHASES.RECOVERY ? (
            <article className="session-metric-card">
              <div className="session-metric-card__label">Recuperare</div>
              <div className="session-metric-card__value">{recoverySecondsLeft}s</div>
            </article>
          ) : null}
        </div>

        {retentions.length > 0 ? (
          <div className="retention-strip">
            {retentions.map((retention, index) => (
              <div className="retention-strip__item" key={`${retention}-${index + 1}`}>
                <span>Runda {index + 1}</span>
                <strong>{formatSeconds(retention)}</strong>
              </div>
            ))}
          </div>
        ) : null}

        <div className="session-actions">
          {phase === PHASES.BREATHING ? (
            <button className="button button--primary" type="button" onClick={onSkipToHold}>
              Treci la retenție
            </button>
          ) : null}

          {phase === PHASES.HOLD ? (
            <button className="button button--primary" type="button" onClick={onFinishHold}>
              Respir acum
            </button>
          ) : null}

          {phase !== PHASES.PAUSED ? (
            <button className="button button--secondary" type="button" onClick={onPauseSession}>
              Pauză
            </button>
          ) : (
            <button className="button button--secondary" type="button" onClick={onResumeSession}>
              Reia sesiunea
            </button>
          )}

          <button className="button button--ghost" type="button" onClick={onCancelSession}>
            Închide
          </button>
        </div>
      </div>
    </section>
  );
}