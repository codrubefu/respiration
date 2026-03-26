import type { MutableRefObject } from 'react';
import { PHASES } from './constants';
import type { FeedbackType, Phase } from './types';

type ExtendedWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export function formatSeconds(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getPhaseTitle(phase: Phase) {
  switch (phase) {
    case PHASES.BREATHING:
      return 'Respirație activă';
    case PHASES.HOLD:
      return 'Retenție';
    case PHASES.RECOVERY:
      return 'Recuperare';
    case PHASES.PAUSED:
      return 'Pauză';
    case PHASES.COMPLETED:
      return 'Finalizat';
    default:
      return 'Pregătire';
  }
}

export function getPhaseInstruction(phase: Phase, inhale: boolean) {
  switch (phase) {
    case PHASES.BREATHING:
      return inhale ? 'Inspiră' : 'Expiră';
    case PHASES.HOLD:
      return 'Ține respirația';
    case PHASES.RECOVERY:
      return 'Inspiră și menține';
    case PHASES.PAUSED:
      return 'Sesiunea este pe pauză';
    case PHASES.COMPLETED:
      return 'Sesiune finalizată';
    default:
      return 'Pregătește sesiunea';
  }
}

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const rawValue = localStorage.getItem(key);
    return rawValue ? (JSON.parse(rawValue) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    return undefined;
  }
}

export async function safeVibrate(enabled: boolean, type: FeedbackType = 'light') {
  if (!enabled || typeof navigator === 'undefined' || !navigator.vibrate) {
    return;
  }

  const patterns: Record<FeedbackType, number | number[]> = {
    light: 30,
    warning: [80, 60, 80],
    success: [40, 30, 40, 30, 40],
  };

  try {
    navigator.vibrate(patterns[type]);
  } catch {
    return undefined;
  }
}

export async function safePlayTone(
  enabled: boolean,
  audioContextRef: MutableRefObject<AudioContext | null>,
  type: FeedbackType = 'light',
) {
  if (!enabled || typeof window === 'undefined') {
    return;
  }

  const AudioContextClass = window.AudioContext ?? (window as ExtendedWindow).webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  try {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    const audioContext = audioContextRef.current;
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    if (type === 'warning') {
      createBeep(audioContext, 520, 0.14, 0.035, 'triangle');
      window.setTimeout(() => createBeep(audioContext, 420, 0.16, 0.03, 'triangle'), 160);
      return;
    }

    if (type === 'success') {
      createBeep(audioContext, 540, 0.1, 0.03, 'sine');
      window.setTimeout(() => createBeep(audioContext, 680, 0.12, 0.035, 'sine'), 120);
      return;
    }

    createBeep(audioContext, 660, 0.08, 0.025, 'sine');
  } catch {
    return undefined;
  }
}

function createBeep(
  audioContext: AudioContext,
  frequency = 660,
  duration = 0.12,
  volume = 0.03,
  type: OscillatorType = 'sine',
) {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();
  const now = audioContext.currentTime;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  gainNode.gain.setValueAtTime(0.0001, now);
  gainNode.gain.exponentialRampToValueAtTime(volume, now + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}