export type Screen = 'dashboard' | 'home' | 'about' | 'history' | 'session' | 'summary';

export type Phase = 'idle' | 'breathing' | 'hold' | 'recovery' | 'paused' | 'completed';

export type BreathingPace = 'slow' | 'medium' | 'fast';

export type FeedbackType = 'light' | 'warning' | 'success';

export interface Settings {
  rounds: number;
  breathsPerRound: number;
  recoverySeconds: number;
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  showHoldTimer: boolean;
  breathingPace: BreathingPace;
  theme: 'dark' | 'light';
}

export interface SessionRecord {
  id: string;
  createdAt: string;
  roundsPlanned: number;
  roundsCompleted: number;
  breathsPerRound: number;
  recoverySeconds: number;
  retentionTimes: number[];
  totalDurationSeconds: number;
  completed: boolean;
}

export type NumericSettingKey = 'rounds' | 'breathsPerRound' | 'recoverySeconds';

export type ToggleSettingKey = 'soundEnabled' | 'vibrationEnabled' | 'showHoldTimer';