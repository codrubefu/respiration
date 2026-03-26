import type { CSSProperties } from 'react';
import { PHASES } from '../constants';
import type { Phase } from '../types';
import './BreathCircle.css';

interface BreathCircleProps {
  phase: Phase;
  inhale: boolean;
  recoveryProgress: number;
  breathingDuration: number;
  breathCount: number;
  breathsPerRound: number;
}

export function BreathCircle({
  phase,
  inhale,
  recoveryProgress,
  breathingDuration,
  breathCount,
  breathsPerRound,
}: BreathCircleProps) {
  const isBreathing = phase === PHASES.BREATHING;
  const size = isBreathing ? 220 : phase === PHASES.RECOVERY ? 210 : 190;
  const opacity = phase === PHASES.HOLD ? 0.7 : 1;
  const scale = phase === PHASES.RECOVERY ? 0.95 + recoveryProgress * 0.05 : 1;
  const animationName = inhale ? 'breatheIn' : 'breatheOut';
  const style = {
    '--circle-size': `${size}px`,
    '--circle-opacity': String(opacity),
    '--circle-scale': String(scale),
    '--circle-animation': isBreathing ? `${animationName} ${breathingDuration}ms linear forwards` : 'none',
  } as CSSProperties;

  return (
    <div className="breath-circle-wrap">
      <div className="breath-circle" style={style}>
        {isBreathing ? (
          <div className="breath-circle__content">
            <div className="breath-circle__count">{breathCount}</div>
            <div className="breath-circle__label">din {breathsPerRound} respirații</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}