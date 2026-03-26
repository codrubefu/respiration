import type { BreathingPace, Phase, Settings } from './types';

export const STORAGE_KEYS = {
  SETTINGS: 'breathing_app_settings_v1',
  HISTORY: 'breathing_app_history_v1',
  SAFETY_ACK: 'breathing_app_safety_ack_v1',
} as const;

export const PHASES = {
  IDLE: 'idle',
  BREATHING: 'breathing',
  HOLD: 'hold',
  RECOVERY: 'recovery',
  PAUSED: 'paused',
  COMPLETED: 'completed',
} as const satisfies Record<string, Phase>;

export const DEFAULT_SETTINGS = {
  rounds: 3,
  breathsPerRound: 30,
  recoverySeconds: 15,
  soundEnabled: false,
  vibrationEnabled: true,
  showHoldTimer: true,
  breathingPace: 'medium',
  theme: 'dark',
} satisfies Settings;

export const BREATHING_SPEEDS: Record<BreathingPace, number> = {
  slow: 2600,
  medium: 2000,
  fast: 1400,
};

export const SAFETY_MESSAGE =
  'Nu practica exercițiile de respirație în apă, în timp ce conduci sau în orice situație în care pierderea atenției poate deveni periculoasă. Oprește sesiunea dacă apar amețeală, disconfort sau stare de rău.';