import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  BREATHING_SPEEDS,
  DEFAULT_SETTINGS,
  PHASES,
  SAFETY_MESSAGE,
  STORAGE_KEYS,
} from './constants';
import { AboutScreen } from './components/AboutScreen';
import { AppHeader } from './components/AppHeader';
import { DashboardScreen } from './components/DashboardScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { HomeScreen } from './components/HomeScreen';
import { SessionScreen } from './components/SessionScreen';
import { SummaryScreen } from './components/SummaryScreen';
import type {
  BreathingPace,
  FeedbackType,
  NumericSettingKey,
  Phase,
  Screen,
  SessionRecord,
  Settings,
  ToggleSettingKey,
} from './types';
import {
  getPhaseInstruction,
  getPhaseTitle,
  readStorage,
  safePlayTone,
  safeVibrate,
  writeStorage,
} from './utils';

export default function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [safetyAccepted, setSafetyAccepted] = useState(false);
  const [notice, setNotice] = useState('');

  const [phase, setPhase] = useState<Phase>(PHASES.IDLE);
  const [previousPhase, setPreviousPhase] = useState<Phase>(PHASES.IDLE);
  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(DEFAULT_SETTINGS.rounds);
  const [breathCount, setBreathCount] = useState(0);
  const [breathsPerRound, setBreathsPerRound] = useState(DEFAULT_SETTINGS.breathsPerRound);
  const [inhale, setInhale] = useState(true);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [recoverySecondsLeft, setRecoverySecondsLeft] = useState(DEFAULT_SETTINGS.recoverySeconds);
  const [retentions, setRetentions] = useState<number[]>([]);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);

  const breathIntervalRef = useRef<number | null>(null);
  const secondIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const phaseRef = useRef<Phase>(PHASES.IDLE);
  const inhaleRef = useRef(true);
  const holdSecondsRef = useRef(0);
  const retentionsRef = useRef<number[]>([]);
  const historyRef = useRef<SessionRecord[]>([]);
  const sessionStartedAtRef = useRef<number | null>(null);
  const transitionLockRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const savedSettings = readStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    const savedHistory = readStorage(STORAGE_KEYS.HISTORY, [] as SessionRecord[]);
    const savedSafety = readStorage(STORAGE_KEYS.SAFETY_ACK, false);

    setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
    setHistory(Array.isArray(savedHistory) ? savedHistory : []);
    setSafetyAccepted(savedSafety === true);
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    inhaleRef.current = inhale;
  }, [inhale]);

  useEffect(() => {
    holdSecondsRef.current = holdSeconds;
  }, [holdSeconds]);

  useEffect(() => {
    retentionsRef.current = retentions;
  }, [retentions]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    sessionStartedAtRef.current = sessionStartedAt;
  }, [sessionStartedAt]);

  useEffect(() => {
    return () => {
      clearBreathingLoop();
      clearSecondLoop();
      void releaseWakeLock();
      void audioContextRef.current?.close?.().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isSessionActive(phaseRef.current)) {
        pauseSession(true);
        return;
      }

      if (!document.hidden && isSessionVisiblePhase(phaseRef.current)) {
        void requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (phase === PHASES.BREATHING) {
      startBreathingLoop();
    } else {
      clearBreathingLoop();
    }

    if (phase === PHASES.HOLD) {
      startHoldTimer();
    } else if (phase === PHASES.RECOVERY) {
      startRecoveryTimer();
    } else {
      clearSecondLoop();
    }

    if (isSessionVisiblePhase(phase)) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }

    return () => {
      clearBreathingLoop();
      clearSecondLoop();
    };
  }, [phase, settings.breathingPace, breathsPerRound, round, totalRounds, settings.recoverySeconds]);

  function persistSettings(nextSettings: Settings) {
    setSettings(nextSettings);
    writeStorage(STORAGE_KEYS.SETTINGS, nextSettings);
  }

  function persistHistory(nextHistory: SessionRecord[]) {
    setHistory(nextHistory);
    writeStorage(STORAGE_KEYS.HISTORY, nextHistory);
  }

  function persistSafetyAck(nextValue: boolean) {
    setSafetyAccepted(nextValue);
    writeStorage(STORAGE_KEYS.SAFETY_ACK, nextValue);
  }

  async function requestWakeLock() {
    try {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || wakeLockRef.current) {
        return false;
      }

      const sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null;
        setWakeLockEnabled(false);
      });
      wakeLockRef.current = sentinel;
      setWakeLockEnabled(true);
      return true;
    } catch {
      setWakeLockEnabled(false);
      return false;
    }
  }

  async function releaseWakeLock() {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      wakeLockRef.current = null;
    }

    setWakeLockEnabled(false);
  }

  function clearBreathingLoop() {
    if (breathIntervalRef.current !== null) {
      window.clearInterval(breathIntervalRef.current);
      breathIntervalRef.current = null;
    }
  }

  function clearSecondLoop() {
    if (secondIntervalRef.current !== null) {
      window.clearInterval(secondIntervalRef.current);
      secondIntervalRef.current = null;
    }
  }

  function resetSessionState() {
    clearBreathingLoop();
    clearSecondLoop();
    void releaseWakeLock();
    transitionLockRef.current = false;
    setPhase(PHASES.IDLE);
    setPreviousPhase(PHASES.IDLE);
    setRound(1);
    setTotalRounds(settings.rounds);
    setBreathCount(0);
    setBreathsPerRound(settings.breathsPerRound);
    setInhale(true);
    setHoldSeconds(0);
    setRecoverySecondsLeft(settings.recoverySeconds);
    setRetentions([]);
    setSessionStartedAt(null);
    setSessionDuration(0);
  }

  async function playFeedback(type: FeedbackType = 'light') {
    await Promise.all([
      safeVibrate(settings.vibrationEnabled, type),
      safePlayTone(settings.soundEnabled, audioContextRef, type),
    ]);
  }

  async function startSession() {
    if (!safetyAccepted) {
      setScreen('home');
      setNotice('Confirmă instrucțiunile de siguranță înainte de a porni sesiunea.');
      return;
    }

    transitionLockRef.current = false;
    setNotice('');
    setTotalRounds(settings.rounds);
    setBreathsPerRound(settings.breathsPerRound);
    setRecoverySecondsLeft(settings.recoverySeconds);
    setRound(1);
    setBreathCount(0);
    setHoldSeconds(0);
    setRetentions([]);
    setSessionStartedAt(Date.now());
    setSessionDuration(0);
    setInhale(true);
    setPhase(PHASES.BREATHING);
    setScreen('session');
    await playFeedback('light');
  }

  function startBreathingLoop() {
    clearBreathingLoop();
    transitionLockRef.current = false;
    const interval = BREATHING_SPEEDS[settings.breathingPace] ?? BREATHING_SPEEDS.medium;

    breathIntervalRef.current = window.setInterval(() => {
      const wasInhale = inhaleRef.current;
      const nextInhale = !wasInhale;

      inhaleRef.current = nextInhale;
      setInhale(nextInhale);

      if (!wasInhale) {
        setBreathCount((previousCount) => {
          const updatedCount = previousCount + 1;

          if (updatedCount >= breathsPerRound && !transitionLockRef.current) {
            transitionLockRef.current = true;
            window.setTimeout(() => {
              void moveToHold();
            }, 50);
          }

          return updatedCount;
        });
      }

      void playFeedback('light');
    }, interval);
  }

  async function moveToHold() {
    if (phaseRef.current !== PHASES.BREATHING) {
      return;
    }

    clearBreathingLoop();
    transitionLockRef.current = true;
    setHoldSeconds(0);
    setInhale(true);
    inhaleRef.current = true;
    setPhase(PHASES.HOLD);
    await playFeedback('warning');
  }

  function skipBreathingToHold() {
    if (phaseRef.current !== PHASES.BREATHING) {
      return;
    }

    void moveToHold();
  }

  function startHoldTimer() {
    clearSecondLoop();
    secondIntervalRef.current = window.setInterval(() => {
      setHoldSeconds((previousValue) => previousValue + 1);
    }, 1000);
  }

  function finishHoldAndStartRecovery() {
    clearSecondLoop();
    const holdValue = holdSecondsRef.current;

    setRetentions((previousRetentions) => {
      const nextRetentions = [...previousRetentions, holdValue];
      retentionsRef.current = nextRetentions;
      return nextRetentions;
    });

    setRecoverySecondsLeft(settings.recoverySeconds);
    setPhase(PHASES.RECOVERY);
    void playFeedback('light');
  }

  function startRecoveryTimer() {
    clearSecondLoop();
    secondIntervalRef.current = window.setInterval(() => {
      setRecoverySecondsLeft((previousValue) => {
        if (previousValue <= 1) {
          clearSecondLoop();
          window.setTimeout(() => {
            void finishRecovery();
          }, 50);
          return 0;
        }

        return previousValue - 1;
      });
    }, 1000);
  }

  async function finishRecovery() {
    await playFeedback('success');

    if (round >= totalRounds) {
      completeSession();
      return;
    }

    transitionLockRef.current = false;
    setRound((previousRound) => previousRound + 1);
    setBreathCount(0);
    setHoldSeconds(0);
    setRecoverySecondsLeft(settings.recoverySeconds);
    setInhale(true);
    setPhase(PHASES.BREATHING);
  }

  function completeSession() {
    clearBreathingLoop();
    clearSecondLoop();
    void releaseWakeLock();
    transitionLockRef.current = false;

    const endedAt = Date.now();
    const startedAt = sessionStartedAtRef.current;
    const finalRetentions = retentionsRef.current;
    const totalDurationSeconds = startedAt ? Math.max(0, Math.floor((endedAt - startedAt) / 1000)) : 0;
    const sessionRecord: SessionRecord = {
      id: String(Date.now()),
      createdAt: new Date().toISOString(),
      roundsPlanned: totalRounds,
      roundsCompleted: totalRounds,
      breathsPerRound,
      recoverySeconds: settings.recoverySeconds,
      retentionTimes: finalRetentions,
      totalDurationSeconds,
      completed: true,
    };

    const nextHistory = [sessionRecord, ...historyRef.current].slice(0, 50);
    persistHistory(nextHistory);
    setSessionDuration(totalDurationSeconds);
    setRetentions(finalRetentions);
    setPhase(PHASES.COMPLETED);
    setScreen('summary');
  }

  function pauseSession(fromBackground = false) {
    if (!isSessionActive(phaseRef.current)) {
      return;
    }

    setPreviousPhase(phaseRef.current);
    clearBreathingLoop();
    clearSecondLoop();
    setPhase(PHASES.PAUSED);

    if (fromBackground) {
      setNotice('Sesiunea a fost pusă pe pauză deoarece tab-ul a devenit inactiv.');
    }
  }

  function resumeSession() {
    if (phase !== PHASES.PAUSED) {
      return;
    }

    setNotice('');
    setPhase(previousPhase || PHASES.BREATHING);
  }

  function cancelSession() {
    resetSessionState();
    setNotice('');
    setScreen('dashboard');
  }

  function updateNumericSetting(key: NumericSettingKey, delta: number, min: number, max: number) {
    const nextValue = Math.max(min, Math.min(max, settings[key] + delta));
    persistSettings({ ...settings, [key]: nextValue });
  }

  function handleToggleSetting(key: ToggleSettingKey, value: boolean) {
    persistSettings({ ...settings, [key]: value });
  }

  async function handleSoundToggle(nextValue: boolean) {
    persistSettings({ ...settings, soundEnabled: nextValue });
    if (nextValue) {
      await safePlayTone(true, audioContextRef, 'light');
    }
  }

  function handleThemeToggle(nextTheme: Settings['theme']) {
    persistSettings({ ...settings, theme: nextTheme });
  }

  function handleBreathingPaceChange(nextPace: BreathingPace) {
    persistSettings({ ...settings, breathingPace: nextPace });
  }

  const breathingDuration = useMemo(
    () => BREATHING_SPEEDS[settings.breathingPace] ?? BREATHING_SPEEDS.medium,
    [settings.breathingPace],
  );

  const currentInstruction = useMemo(
    () => getPhaseInstruction(phase, inhale),
    [phase, inhale],
  );

  const recoveryProgress = useMemo(
    () => (settings.recoverySeconds - recoverySecondsLeft) / Math.max(1, settings.recoverySeconds),
    [settings.recoverySeconds, recoverySecondsLeft],
  );

  const bestRetention = useMemo(() => {
    if (history.length === 0) {
      return 0;
    }

    return Math.max(...history.flatMap((item) => item.retentionTimes), 0);
  }, [history]);

  const averageRetention = useMemo(() => {
    const retentionValues = history.flatMap((item) => item.retentionTimes);
    if (retentionValues.length === 0) {
      return 0;
    }

    const totalRetention = retentionValues.reduce((sum, value) => sum + value, 0);
    return Math.round(totalRetention / retentionValues.length);
  }, [history]);

  const summaryBestRetention = retentions.length > 0 ? Math.max(...retentions) : 0;
  const phaseTitle = getPhaseTitle(phase);

  return (
    <div className={`app theme-${settings.theme}`}>
      <div className="app-shell">
        <AppHeader
          currentScreen={screen}
          theme={settings.theme}
          onNavigate={setScreen}
          onThemeChange={handleThemeToggle}
        />

        {screen === 'dashboard' && (
          <DashboardScreen
            averageRetention={averageRetention}
            bestRetention={bestRetention}
            history={history}
            notice={notice}
            safetyAccepted={safetyAccepted}
            wakeLockEnabled={wakeLockEnabled}
            onConfigure={() => setScreen('home')}
            onStartSession={() => {
              void startSession();
            }}
          />
        )}

        {screen === 'about' && <AboutScreen safetyMessage={SAFETY_MESSAGE} />}

        {screen === 'home' && (
          <HomeScreen
            notice={notice}
            safetyAccepted={safetyAccepted}
            safetyMessage={SAFETY_MESSAGE}
            settings={settings}
            onBreathingPaceChange={handleBreathingPaceChange}
            onNumericSettingChange={updateNumericSetting}
            onSafetyAcceptedChange={persistSafetyAck}
            onSoundToggle={handleSoundToggle}
            onStartSession={() => {
              void startSession();
            }}
            onToggleSetting={handleToggleSetting}
          />
        )}

        {screen === 'session' && (
          <SessionScreen
            breathCount={breathCount}
            breathsPerRound={breathsPerRound}
            breathingDuration={breathingDuration}
            currentInstruction={currentInstruction}
            holdSeconds={holdSeconds}
            inhale={inhale}
            notice={notice}
            phase={phase}
            phaseTitle={phaseTitle}
            recoveryProgress={recoveryProgress}
            recoverySecondsLeft={recoverySecondsLeft}
            retentions={retentions}
            round={round}
            settings={settings}
            totalRounds={totalRounds}
            onCancelSession={cancelSession}
            onFinishHold={finishHoldAndStartRecovery}
            onPauseSession={() => pauseSession(false)}
            onResumeSession={resumeSession}
            onSkipToHold={skipBreathingToHold}
          />
        )}

        {screen === 'summary' && (
          <SummaryScreen
            bestRetention={summaryBestRetention}
            breathsPerRound={breathsPerRound}
            recoverySeconds={settings.recoverySeconds}
            retentions={retentions}
            rounds={totalRounds}
            sessionDuration={sessionDuration}
            onGoToDashboard={() => setScreen('dashboard')}
            onStartAgain={() => {
              void startSession();
            }}
          />
        )}

        {screen === 'history' && <HistoryScreen history={history} />}
      </div>
    </div>
  );
}

function isSessionActive(phase: Phase) {
  return [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY].includes(phase);
}

function isSessionVisiblePhase(phase: Phase) {
  return [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY, PHASES.PAUSED].includes(phase);
}import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import {
  BREATHING_SPEEDS,
  DEFAULT_SETTINGS,
  PHASES,
  SAFETY_MESSAGE,
  STORAGE_KEYS,
} from './constants';
import { AboutScreen } from './components/AboutScreen';
import { AppHeader } from './components/AppHeader';
import { DashboardScreen } from './components/DashboardScreen';
import { HistoryScreen } from './components/HistoryScreen';
import { HomeScreen } from './components/HomeScreen';
import { SessionScreen } from './components/SessionScreen';
import { SummaryScreen } from './components/SummaryScreen';
import type {
  BreathingPace,
  FeedbackType,
  NumericSettingKey,
  Phase,
  Screen,
  SessionRecord,
  Settings,
} from './types';
import {
  getPhaseInstruction,
  getPhaseTitle,
  readStorage,
  safePlayTone,
  safeVibrate,
  writeStorage,
} from './utils';

export default function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [history, setHistory] = useState<SessionRecord[]>([]);
  const [safetyAccepted, setSafetyAccepted] = useState(false);
  const [notice, setNotice] = useState('');

  const [phase, setPhase] = useState<Phase>(PHASES.IDLE);
  const [previousPhase, setPreviousPhase] = useState<Phase>(PHASES.IDLE);
  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(DEFAULT_SETTINGS.rounds);
  const [breathCount, setBreathCount] = useState(0);
  const [breathsPerRound, setBreathsPerRound] = useState(DEFAULT_SETTINGS.breathsPerRound);
  const [inhale, setInhale] = useState(true);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [recoverySecondsLeft, setRecoverySecondsLeft] = useState(DEFAULT_SETTINGS.recoverySeconds);
  const [retentions, setRetentions] = useState<number[]>([]);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);

  const breathIntervalRef = useRef<number | null>(null);
  const secondIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const phaseRef = useRef<Phase>(PHASES.IDLE);
  const inhaleRef = useRef(true);
  const holdSecondsRef = useRef(0);
  const retentionsRef = useRef<number[]>([]);
  const historyRef = useRef<SessionRecord[]>([]);
  const sessionStartedAtRef = useRef<number | null>(null);
  const transitionLockRef = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    const savedSettings = readStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    const savedHistory = readStorage<SessionRecord[]>(STORAGE_KEYS.HISTORY, []);
    const savedSafety = readStorage(STORAGE_KEYS.SAFETY_ACK, false);

    setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
    setHistory(Array.isArray(savedHistory) ? savedHistory : []);
    setSafetyAccepted(savedSafety === true);
  }, []);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    inhaleRef.current = inhale;
  }, [inhale]);

  useEffect(() => {
    holdSecondsRef.current = holdSeconds;
  }, [holdSeconds]);

  useEffect(() => {
    retentionsRef.current = retentions;
  }, [retentions]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    sessionStartedAtRef.current = sessionStartedAt;
  }, [sessionStartedAt]);

  useEffect(() => {
    return () => {
      clearBreathingLoop();
      clearSecondLoop();
      void releaseWakeLock();
      void audioContextRef.current?.close?.().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isSessionActive(phaseRef.current)) {
        pauseSession(true);
        return;
      }

      if (!document.hidden && isSessionVisiblePhase(phaseRef.current)) {
        void requestWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (phase === PHASES.BREATHING) {
      startBreathingLoop();
    } else {
      clearBreathingLoop();
    }

    if (phase === PHASES.HOLD) {
      startHoldTimer();
    } else if (phase === PHASES.RECOVERY) {
      startRecoveryTimer();
    } else {
      clearSecondLoop();
    }

    if (isSessionVisiblePhase(phase)) {
      void requestWakeLock();
    } else {
      void releaseWakeLock();
    }

    return () => {
      clearBreathingLoop();
      clearSecondLoop();
    };
  }, [phase, settings.breathingPace, breathsPerRound, round, totalRounds, settings.recoverySeconds]);

  function persistSettings(nextSettings: Settings) {
    setSettings(nextSettings);
    writeStorage(STORAGE_KEYS.SETTINGS, nextSettings);
  }

  function persistHistory(nextHistory: SessionRecord[]) {
    setHistory(nextHistory);
    writeStorage(STORAGE_KEYS.HISTORY, nextHistory);
  }

  function persistSafetyAck(nextValue: boolean) {
    setSafetyAccepted(nextValue);
    writeStorage(STORAGE_KEYS.SAFETY_ACK, nextValue);
  }

  async function requestWakeLock() {
    try {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || wakeLockRef.current) {
        return false;
      }

      const sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        wakeLockRef.current = null;
        setWakeLockEnabled(false);
      });
      wakeLockRef.current = sentinel;
      setWakeLockEnabled(true);
      return true;
    } catch {
      setWakeLockEnabled(false);
      return false;
    }
  }

  async function releaseWakeLock() {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {
      wakeLockRef.current = null;
    }

    setWakeLockEnabled(false);
  }

  function clearBreathingLoop() {
    if (breathIntervalRef.current !== null) {
      window.clearInterval(breathIntervalRef.current);
      breathIntervalRef.current = null;
    }
  }

  function clearSecondLoop() {
    if (secondIntervalRef.current !== null) {
      window.clearInterval(secondIntervalRef.current);
      secondIntervalRef.current = null;
    }
  }

  function resetSessionState() {
    clearBreathingLoop();
    clearSecondLoop();
    void releaseWakeLock();
    transitionLockRef.current = false;
    setPhase(PHASES.IDLE);
    setPreviousPhase(PHASES.IDLE);
    setRound(1);
    setTotalRounds(settings.rounds);
    setBreathCount(0);
    setBreathsPerRound(settings.breathsPerRound);
    setInhale(true);
    setHoldSeconds(0);
    setRecoverySecondsLeft(settings.recoverySeconds);
    setRetentions([]);
    setSessionStartedAt(null);
    setSessionDuration(0);
  }

  async function playFeedback(type: FeedbackType = 'light') {
    await Promise.all([
      safeVibrate(settings.vibrationEnabled, type),
      safePlayTone(settings.soundEnabled, audioContextRef, type),
    ]);
  }

  async function startSession() {
    if (!safetyAccepted) {
      setScreen('home');
      setNotice('Confirmă instrucțiunile de siguranță înainte de a porni sesiunea.');
      return;
    }

    transitionLockRef.current = false;
    setNotice('');
    setTotalRounds(settings.rounds);
    setBreathsPerRound(settings.breathsPerRound);
    setRecoverySecondsLeft(settings.recoverySeconds);
    setRound(1);
    setBreathCount(0);
    setHoldSeconds(0);
    setRetentions([]);
    setSessionStartedAt(Date.now());
    setSessionDuration(0);
    setInhale(true);
    setPhase(PHASES.BREATHING);
    setScreen('session');
    await playFeedback('light');
  }

  function startBreathingLoop() {
    clearBreathingLoop();
    transitionLockRef.current = false;
    const interval = BREATHING_SPEEDS[settings.breathingPace] ?? BREATHING_SPEEDS.medium;

    breathIntervalRef.current = window.setInterval(() => {
      const wasInhale = inhaleRef.current;
      const nextInhale = !wasInhale;

      inhaleRef.current = nextInhale;
      setInhale(nextInhale);

      if (!wasInhale) {
        setBreathCount((previousCount) => {
          const updatedCount = previousCount + 1;

          if (updatedCount >= breathsPerRound && !transitionLockRef.current) {
            transitionLockRef.current = true;
            window.setTimeout(() => {
              void moveToHold();
            }, 50);
          }

          return updatedCount;
        });
      }

      void playFeedback('light');
    }, interval);
  }

  async function moveToHold() {
    if (phaseRef.current !== PHASES.BREATHING) {
      return;
    }

    clearBreathingLoop();
    transitionLockRef.current = true;
    setHoldSeconds(0);
    setInhale(true);
    inhaleRef.current = true;
    setPhase(PHASES.HOLD);
    await playFeedback('warning');
  }

  function skipBreathingToHold() {
    if (phaseRef.current !== PHASES.BREATHING) {
      return;
    }

    void moveToHold();
  }

  function startHoldTimer() {
    clearSecondLoop();
    secondIntervalRef.current = window.setInterval(() => {
      setHoldSeconds((previousValue) => previousValue + 1);
    }, 1000);
  }

  function finishHoldAndStartRecovery() {
    clearSecondLoop();
    const holdValue = holdSecondsRef.current;

    setRetentions((previousRetentions) => {
      const nextRetentions = [...previousRetentions, holdValue];
      retentionsRef.current = nextRetentions;
      return nextRetentions;
    });

    setRecoverySecondsLeft(settings.recoverySeconds);
    setPhase(PHASES.RECOVERY);
    void playFeedback('light');
  }

  function startRecoveryTimer() {
    clearSecondLoop();
    secondIntervalRef.current = window.setInterval(() => {
      setRecoverySecondsLeft((previousValue) => {
        if (previousValue <= 1) {
          clearSecondLoop();
          window.setTimeout(() => {
            void finishRecovery();
          }, 50);
          return 0;
        }

        return previousValue - 1;
      });
    }, 1000);
  }

  async function finishRecovery() {
    await playFeedback('success');

    if (round >= totalRounds) {
      completeSession();
      return;
    }

    transitionLockRef.current = false;
    setRound((previousRound) => previousRound + 1);
    setBreathCount(0);
    setHoldSeconds(0);
    setRecoverySecondsLeft(settings.recoverySeconds);
    setInhale(true);
    setPhase(PHASES.BREATHING);
  }

  function completeSession() {
    clearBreathingLoop();
    clearSecondLoop();
    void releaseWakeLock();
    transitionLockRef.current = false;

    const endedAt = Date.now();
    const startedAt = sessionStartedAtRef.current;
    const finalRetentions = retentionsRef.current;
    const totalDurationSeconds = startedAt ? Math.max(0, Math.floor((endedAt - startedAt) / 1000)) : 0;
    const sessionRecord: SessionRecord = {
      id: String(Date.now()),
      createdAt: new Date().toISOString(),
      roundsPlanned: totalRounds,
      roundsCompleted: totalRounds,
      breathsPerRound,
      recoverySeconds: settings.recoverySeconds,
      retentionTimes: finalRetentions,
      totalDurationSeconds,
      completed: true,
    };

    const nextHistory = [sessionRecord, ...historyRef.current].slice(0, 50);
    persistHistory(nextHistory);
    setSessionDuration(totalDurationSeconds);
    setRetentions(finalRetentions);
    setPhase(PHASES.COMPLETED);
    setScreen('summary');
  }

  function pauseSession(fromBackground = false) {
    if (!isSessionActive(phaseRef.current)) {
      return;
    }

    setPreviousPhase(phaseRef.current);
    clearBreathingLoop();
    clearSecondLoop();
    setPhase(PHASES.PAUSED);

    if (fromBackground) {
      setNotice('Sesiunea a fost pusă pe pauză deoarece tab-ul a devenit inactiv.');
    }
  }

  function resumeSession() {
    if (phase !== PHASES.PAUSED) {
      return;
    }

    setNotice('');
    setPhase(previousPhase || PHASES.BREATHING);
  }

  function cancelSession() {
    resetSessionState();
    setNotice('');
    setScreen('dashboard');
  }

  function updateNumericSetting(key: NumericSettingKey, delta: number, min: number, max: number) {
    const nextValue = Math.max(min, Math.min(max, settings[key] + delta));
    persistSettings({ ...settings, [key]: nextValue });
  }

  async function handleSoundToggle(nextValue: boolean) {
    persistSettings({ ...settings, soundEnabled: nextValue });
    if (nextValue) {
      await safePlayTone(true, audioContextRef, 'light');
    }
  }

  function handleThemeToggle(nextTheme: Settings['theme']) {
    persistSettings({ ...settings, theme: nextTheme });
  }

  function handleBreathingPaceChange(nextPace: BreathingPace) {
    persistSettings({ ...settings, breathingPace: nextPace });
  }

  const breathingDuration = useMemo(
    () => BREATHING_SPEEDS[settings.breathingPace] ?? BREATHING_SPEEDS.medium,
    [settings.breathingPace],
  );

  const currentInstruction = useMemo(
    () => getPhaseInstruction(phase, inhale),
    [phase, inhale],
  );

  const recoveryProgress = useMemo(
    () => (settings.recoverySeconds - recoverySecondsLeft) / Math.max(1, settings.recoverySeconds),
    [settings.recoverySeconds, recoverySecondsLeft],
  );

  const bestRetention = useMemo(() => {
    if (history.length === 0) {
      return 0;
    }

    return Math.max(...history.flatMap((item) => item.retentionTimes), 0);
  }, [history]);

  const averageRetention = useMemo(() => {
    const retentionValues = history.flatMap((item) => item.retentionTimes);
    if (retentionValues.length === 0) {
      return 0;
    }

    const totalRetention = retentionValues.reduce((sum, value) => sum + value, 0);
    return Math.round(totalRetention / retentionValues.length);
  }, [history]);

  const summaryBestRetention = retentions.length > 0 ? Math.max(...retentions) : 0;
  const phaseTitle = getPhaseTitle(phase);

  return (
    <div className={`app theme-${settings.theme}`}>
      <div className="app-shell">
        <AppHeader
          currentScreen={screen}
          theme={settings.theme}
          onNavigate={setScreen}
          onThemeChange={handleThemeToggle}
        />

        {screen === 'dashboard' && (
          <DashboardScreen
            averageRetention={averageRetention}
            bestRetention={bestRetention}
            history={history}
            notice={notice}
            safetyAccepted={safetyAccepted}
            wakeLockEnabled={wakeLockEnabled}
            onConfigure={() => setScreen('home')}
            onStartSession={() => {
              void startSession();
            }}
          />
        )}

        {screen === 'about' && <AboutScreen safetyMessage={SAFETY_MESSAGE} />}

        {screen === 'home' && (
          <HomeScreen
            notice={notice}
            safetyAccepted={safetyAccepted}
            safetyMessage={SAFETY_MESSAGE}
            settings={settings}
            onBreathingPaceChange={handleBreathingPaceChange}
            onNumericSettingChange={updateNumericSetting}
            onSafetyAcceptedChange={persistSafetyAck}
            onSoundToggle={handleSoundToggle}
            onStartSession={() => {
              void startSession();
            }}
            onToggleSetting={(key, value) => persistSettings({ ...settings, [key]: value })}
          />
        )}

        {screen === 'session' && (
          <SessionScreen
            breathCount={breathCount}
            breathsPerRound={breathsPerRound}
            breathingDuration={breathingDuration}
            currentInstruction={currentInstruction}
            holdSeconds={holdSeconds}
            inhale={inhale}
            notice={notice}
            phase={phase}
            phaseTitle={phaseTitle}
            recoveryProgress={recoveryProgress}
            recoverySecondsLeft={recoverySecondsLeft}
            retentions={retentions}
            round={round}
            settings={settings}
            totalRounds={totalRounds}
            onCancelSession={cancelSession}
            onFinishHold={finishHoldAndStartRecovery}
            onPauseSession={() => pauseSession(false)}
            onResumeSession={resumeSession}
            onSkipToHold={skipBreathingToHold}
          />
        )}

        {screen === 'summary' && (
          <SummaryScreen
            bestRetention={summaryBestRetention}
            breathsPerRound={breathsPerRound}
            recoverySeconds={settings.recoverySeconds}
            retentions={retentions}
            rounds={totalRounds}
            sessionDuration={sessionDuration}
            onGoToDashboard={() => setScreen('dashboard')}
            onStartAgain={() => {
              void startSession();
            }}
          />
        )}

        {screen === 'history' && <HistoryScreen history={history} />}
      </div>
    </div>
  );
}

function isSessionActive(phase: Phase) {
  return [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY].includes(phase);
}

function isSessionVisiblePhase(phase: Phase) {
  return [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY, PHASES.PAUSED].includes(phase);
}import React, { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEYS = {
  SETTINGS: 'breathing_app_settings_v1',
  HISTORY: 'breathing_app_history_v1',
  SAFETY_ACK: 'breathing_app_safety_ack_v1',
};

const PHASES = {
  IDLE: 'idle',
  BREATHING: 'breathing',
  HOLD: 'hold',
  RECOVERY: 'recovery',
  PAUSED: 'paused',
  COMPLETED: 'completed',
};

const DEFAULT_SETTINGS = {
  rounds: 3,
  breathsPerRound: 30,
  recoverySeconds: 15,
  soundEnabled: false,
  vibrationEnabled: true,
  showHoldTimer: true,
  breathingPace: 'medium',
  theme: 'dark',
};

const BREATHING_SPEEDS = {
  slow: 2600,
  medium: 2000,
  fast: 1400,
};

const SAFETY_MESSAGE =
  'Nu practica exercițiile de respirație în apă, în timp ce conduci sau în orice situație în care pierderea atenției poate deveni periculoasă. Oprește sesiunea dacă apar amețeală, disconfort sau stare de rău.';

function formatSeconds(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getPhaseTitle(phase) {
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

function getPhaseInstruction(phase, inhale) {
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

async function safeVibrate(enabled, type = 'light') {
  if (!enabled || typeof navigator === 'undefined' || !navigator.vibrate) return;
  const patterns = { light: 30, warning: [80, 60, 80], success: [40, 30, 40, 30, 40] };
  try { navigator.vibrate(patterns[type] || patterns.light); } catch {}
}

function createBeep(audioContext, frequency = 660, duration = 0.12, volume = 0.03, type = 'sine') {
  if (!audioContext) return;
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

async function safePlayTone(enabled, audioContextRef, type = 'light') {
  if (!enabled || typeof window === 'undefined') return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
    const audioContext = audioContextRef.current;
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (type === 'warning') {
      createBeep(audioContext, 520, 0.14, 0.035, 'triangle');
      setTimeout(() => createBeep(audioContext, 420, 0.16, 0.03, 'triangle'), 160);
      return;
    }
    if (type === 'success') {
      createBeep(audioContext, 540, 0.1, 0.03, 'sine');
      setTimeout(() => createBeep(audioContext, 680, 0.12, 0.035, 'sine'), 120);
      return;
    }
    createBeep(audioContext, 660, 0.08, 0.025, 'sine');
  } catch {}
}

function readStorage(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function Stepper({ label, value, onMinus, onPlus, min = 1, max = 99, suffix = '' }) {
  return (
    <div style={styles.settingRow}>
      <div style={styles.settingLabel}>{label}</div>
      <div style={styles.stepperWrap}>
        <button onClick={onMinus} style={styles.stepperButton} disabled={value <= min}>−</button>
        <div style={styles.stepperValue}>{value}{suffix}</div>
        <button onClick={onPlus} style={styles.stepperButton} disabled={value >= max}>+</button>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div style={styles.toggleRow}>
      <div style={styles.toggleLabelWrap}>
        <div style={{ ...styles.settingLabel, marginBottom: 0 }}>{label}</div>
      </div>
      <label style={styles.switch}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={styles.switchInput} />
        <span style={{ ...styles.switchTrack, ...(checked ? styles.switchTrackActive : {}) }}>
          <span style={{ ...styles.switchThumb, ...(checked ? styles.switchThumbActive : {}) }} />
        </span>
      </label>
    </div>
  );
}

function BreathCircle({ phase, inhale, recoveryProgress, breathingDuration, breathCount, breathsPerRound }) {
  const isBreathing = phase === PHASES.BREATHING;
  const size = isBreathing ? 220 : phase === PHASES.RECOVERY ? 210 : 190;
  const opacity = phase === PHASES.HOLD ? 0.7 : 1;
  const scale = phase === PHASES.RECOVERY ? 0.95 + recoveryProgress * 0.05 : 1;
  const animationName = inhale ? 'breatheIn' : 'breatheOut';

  return (
    <div style={styles.circleContainer}>
      <div
        style={{
          ...styles.circle,
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity,
          transform: `scale(${scale})`,
          animation: isBreathing ? `${animationName} ${breathingDuration}ms linear forwards` : 'none',
        }}
      >
        {isBreathing ? (
          <div style={styles.circleContent}>
            <div style={styles.circleCount}>{breathCount}</div>
            <div style={styles.circleCountLabel}>din {breathsPerRound} respirații</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('dashboard');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [history, setHistory] = useState([]);
  const [safetyAccepted, setSafetyAccepted] = useState(false);

  const [phase, setPhase] = useState(PHASES.IDLE);
  const [previousPhase, setPreviousPhase] = useState(PHASES.IDLE);
  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(DEFAULT_SETTINGS.rounds);
  const [breathCount, setBreathCount] = useState(0);
  const [breathsPerRound, setBreathsPerRound] = useState(DEFAULT_SETTINGS.breathsPerRound);
  const [inhale, setInhale] = useState(true);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [recoverySecondsLeft, setRecoverySecondsLeft] = useState(DEFAULT_SETTINGS.recoverySeconds);
  const [retentions, setRetentions] = useState([]);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [notice, setNotice] = useState('');
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);

  const breathIntervalRef = useRef(null);
  const audioContextRef = useRef(null);
  const secondIntervalRef = useRef(null);
  const phaseRef = useRef(PHASES.IDLE);
  const inhaleRef = useRef(true);
  const holdSecondsRef = useRef(0);
  const retentionsRef = useRef([]);
  const historyRef = useRef([]);
  const sessionStartedAtRef = useRef(null);
  const transitionLockRef = useRef(false);
  const wakeLockRef = useRef(null);

  useEffect(() => {
    const savedSettings = readStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    const savedHistory = readStorage(STORAGE_KEYS.HISTORY, []);
    const savedSafety = readStorage(STORAGE_KEYS.SAFETY_ACK, false);
    setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
    setHistory(Array.isArray(savedHistory) ? savedHistory : []);
    setSafetyAccepted(savedSafety === true);
  }, []);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { inhaleRef.current = inhale; }, [inhale]);
  useEffect(() => { holdSecondsRef.current = holdSeconds; }, [holdSeconds]);
  useEffect(() => { retentionsRef.current = retentions; }, [retentions]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { sessionStartedAtRef.current = sessionStartedAt; }, [sessionStartedAt]);

  useEffect(() => () => {
    clearBreathingLoop();
    clearSecondLoop();
    releaseWakeLock();
    if (audioContextRef.current?.close) audioContextRef.current.close().catch(() => {});
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY].includes(phaseRef.current)) {
        pauseSession(true);
        return;
      }

      if (!document.hidden && [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY, PHASES.PAUSED].includes(phaseRef.current)) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (phase === PHASES.BREATHING) startBreathingLoop(); else clearBreathingLoop();
    if (phase === PHASES.HOLD) startHoldTimer(); else if (phase === PHASES.RECOVERY) startRecoveryTimer(); else clearSecondLoop();

    if ([PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY, PHASES.PAUSED].includes(phase)) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    return () => { clearBreathingLoop(); clearSecondLoop(); };
  }, [phase]);

  function persistSettings(next) { setSettings(next); writeStorage(STORAGE_KEYS.SETTINGS, next); }

  async function requestWakeLock() {
    try {
      if (typeof navigator === 'undefined' || !navigator.wakeLock || wakeLockRef.current) return false;
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener?.('release', () => {
        wakeLockRef.current = null;
        setWakeLockEnabled(false);
      });
      setWakeLockEnabled(true);
      return true;
    } catch {
      setWakeLockEnabled(false);
      return false;
    }
  }

  async function releaseWakeLock() {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {}
    setWakeLockEnabled(false);
  }
  function persistHistory(next) { setHistory(next); writeStorage(STORAGE_KEYS.HISTORY, next); }

  function clearBreathingLoop() { if (breathIntervalRef.current) { clearInterval(breathIntervalRef.current); breathIntervalRef.current = null; } }
  function clearSecondLoop() { if (secondIntervalRef.current) { clearInterval(secondIntervalRef.current); secondIntervalRef.current = null; } }

  function resetSessionState() {
    clearBreathingLoop(); clearSecondLoop(); releaseWakeLock(); transitionLockRef.current = false;
    setPhase(PHASES.IDLE); setPreviousPhase(PHASES.IDLE); setRound(1); setBreathCount(0);
    setInhale(true); setHoldSeconds(0); setRecoverySecondsLeft(settings.recoverySeconds);
    setRetentions([]); setSessionStartedAt(null); setSessionDuration(0);
  }

  async function playFeedback(type = 'light') {
    await Promise.all([ safeVibrate(settings.vibrationEnabled, type), safePlayTone(settings.soundEnabled, audioContextRef, type) ]);
  }

  async function startSession(forceStart = false) {
    if (!safetyAccepted && !forceStart) { setShowSafetyModal(true); return; }
    transitionLockRef.current = false; setShowSafetyModal(false); setNotice('');
    setTotalRounds(settings.rounds); setBreathsPerRound(settings.breathsPerRound);
    setRecoverySecondsLeft(settings.recoverySeconds); setRound(1); setBreathCount(0);
    setHoldSeconds(0); setRetentions([]); setSessionStartedAt(Date.now()); setSessionDuration(0);
    setInhale(true); setPhase(PHASES.BREATHING); setScreen('session'); await playFeedback('light');
  }

  function startBreathingLoop() {
    clearBreathingLoop(); transitionLockRef.current = false;
    const interval = BREATHING_SPEEDS[settings.breathingPace] || BREATHING_SPEEDS.medium;
    breathIntervalRef.current = setInterval(() => {
      const wasInhale = inhaleRef.current;
      const nextInhale = !wasInhale;
      inhaleRef.current = nextInhale; setInhale(nextInhale);
      if (!wasInhale) {
        setBreathCount(prev => {
          const updated = prev + 1;
          if (updated >= breathsPerRound && !transitionLockRef.current) {
            transitionLockRef.current = true; setTimeout(() => moveToHold(), 50);
          }
          return updated;
        });
      }
      playFeedback('light');
    }, interval);
  }

  async function moveToHold() {
    if (phaseRef.current !== PHASES.BREATHING) return;
    clearBreathingLoop(); transitionLockRef.current = true; setHoldSeconds(0);
    setInhale(true); inhaleRef.current = true; setPhase(PHASES.HOLD);
    await playFeedback('warning');
  }

  function skipBreathingToHold() { if (phaseRef.current !== PHASES.BREATHING) return; moveToHold(); }

  function startHoldTimer() { clearSecondLoop(); secondIntervalRef.current = setInterval(() => setHoldSeconds(p => p + 1), 1000); }

  function finishHoldAndStartRecovery() {
    clearSecondLoop(); const holdValue = holdSecondsRef.current;
    setRetentions(prev => { const next = [...prev, holdValue]; retentionsRef.current = next; return next; });
    setRecoverySecondsLeft(settings.recoverySeconds); setPhase(PHASES.RECOVERY); playFeedback('light');
  }

  function startRecoveryTimer() {
    clearSecondLoop();
    secondIntervalRef.current = setInterval(() => {
      setRecoverySecondsLeft(prev => {
        if (prev <= 1) { clearSecondLoop(); setTimeout(() => finishRecovery(), 50); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  async function finishRecovery() {
    await playFeedback('success');
    if (round >= totalRounds) { completeSession(); return; }
    transitionLockRef.current = false; setRound(r => r + 1); setBreathCount(0);
    setHoldSeconds(0); setRecoverySecondsLeft(settings.recoverySeconds); setInhale(true); setPhase(PHASES.BREATHING);
  }

  function completeSession() {
    clearBreathingLoop(); clearSecondLoop(); releaseWakeLock(); transitionLockRef.current = false;
    const endedAt = Date.now(); const startedAt = sessionStartedAtRef.current;
    const finalRetentions = retentionsRef.current;
    const totalDurationSeconds = startedAt ? Math.max(0, Math.floor((endedAt - startedAt) / 1000)) : 0;
    const sessionRecord = {
      id: String(Date.now()), createdAt: new Date().toISOString(),
      roundsPlanned: totalRounds, roundsCompleted: totalRounds, breathsPerRound,
      recoverySeconds: settings.recoverySeconds, retentionTimes: finalRetentions,
      totalDurationSeconds, completed: true,
    };
    const nextHistory = [sessionRecord, ...historyRef.current].slice(0, 50);
    persistHistory(nextHistory);
    setSessionDuration(totalDurationSeconds); setRetentions(finalRetentions);
    setPhase(PHASES.COMPLETED); setScreen('summary');
  }

  function pauseSession(fromBackground = false) {
    if (![PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY].includes(phaseRef.current)) return;
    setPreviousPhase(phaseRef.current); clearBreathingLoop(); clearSecondLoop(); setPhase(PHASES.PAUSED);
    if (fromBackground) setNotice('Sesiunea a fost pusă pe pauză deoarece tab-ul a devenit inactiv.');
  }

  function resumeSession() { if (phase !== PHASES.PAUSED) return; setPhase(previousPhase || PHASES.BREATHING); }
  function cancelSession() {
    // direct close (no modal)
    resetSessionState();
    setScreen('dashboard');
  }
  function confirmCancelSession() { setShowCancelModal(false); resetSessionState(); setScreen('home'); }

  function updateNumericSetting(key, delta, min, max) {
    const nextValue = Math.max(min, Math.min(max, settings[key] + delta));
    persistSettings({ ...settings, [key]: nextValue });
  }

  const breathingDuration = useMemo(() => BREATHING_SPEEDS[settings.breathingPace] || BREATHING_SPEEDS.medium, [settings.breathingPace]);
  const currentInstruction = useMemo(() => getPhaseInstruction(phase, inhale), [phase, inhale]);
  const recoveryProgress = useMemo(() => (settings.recoverySeconds - recoverySecondsLeft) / Math.max(1, settings.recoverySeconds), [settings.recoverySeconds, recoverySecondsLeft]);

  const bestRetention = history.length ? Math.max(...history.flatMap(i => i.retentionTimes || [0]), 0) : 0;
  const retentionValues = history.flatMap(i => i.retentionTimes || []);
  const averageRetention = retentionValues.length ? Math.round(retentionValues.reduce((s, v) => s + v, 0) / retentionValues.length) : 0;

  function renderHeader() {
    return (
      <div style={styles.headerShell}>
        <div style={styles.headerTopRow}>
          <button style={styles.headerBrandButton} onClick={() => setScreen('dashboard')}>
            <span style={styles.headerBrandDot} />
            <span>Respirație 3 faze</span>
          </button>
          <label style={styles.themeSwitchWrap} aria-label="Schimbă tema">
            <span style={styles.themeIcon}>{settings.theme === 'dark' ? '🌙' : '☀️'}</span>
            <span style={styles.switch}>
              <input
                type="checkbox"
                checked={settings.theme === 'light'}
                onChange={e => persistSettings({ ...settings, theme: e.target.checked ? 'light' : 'dark' })}
                style={styles.switchInput}
              />
              <span style={{ ...styles.switchTrack, ...(settings.theme === 'light' ? styles.switchTrackActive : {}) }}>
                <span style={{ ...styles.switchThumb, ...(settings.theme === 'light' ? styles.switchThumbActive : {}) }} />
              </span>
            </span>
          </label>
        </div>
        <div style={styles.headerNavRow} data-header-actions="true">
          <button style={styles.headerNavButton} onClick={() => setScreen('dashboard')}>Dashboard</button>
          <button style={styles.headerNavButton} onClick={() => setScreen('home')}>Configurare</button>
          <button style={styles.headerNavButton} onClick={() => setScreen('about')}>Despre</button>
          <button style={styles.headerNavButton} onClick={() => setScreen('history')}>Istoric</button>
        </div>
      </div>
    );
  }

  function renderDashboard() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}

          <div style={styles.heroCard}>
            <div style={styles.wakeLockBadge}>{wakeLockEnabled ? 'Ecran activ' : 'Ecran normal'}</div>
            <div style={styles.heroTopLine}>Dashboard</div>
            <h1 style={styles.title}>Respirație în 3 faze</h1>
            <p style={styles.subtitle}>Pornește rapid o sesiune și vezi progresul.</p>
            <div style={styles.dashboardActionGrid} data-dashboard-actions="true">
              <button style={styles.primaryButton} onClick={startSession}>Start sesiune</button>
              <button style={styles.secondaryButtonWide} onClick={() => setScreen('home')}>Configurare sesiune</button>
            </div>
          </div>

          <div style={styles.statsGrid} data-stats-grid="true">
            <div style={styles.statCard}>
              <div style={styles.statValue}>{history.length}</div>
              <div style={styles.statLabel}>Sesiuni totale</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{formatSeconds(bestRetention)}</div>
              <div style={styles.statLabel}>Record retenție</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{formatSeconds(averageRetention)}</div>
              <div style={styles.statLabel}>Medie retenții</div>
            </div>
          </div>

          <div style={styles.dashboardGrid} data-dashboard-grid="true">
            <div style={styles.card}>
              <div style={styles.cardTitle}>Istoric sesiuni</div>
              {history.length === 0 ? (
                <div style={styles.emptyText}>Nu există sesiuni salvate încă.</div>
              ) : (
                history.map(item => (
                  <div key={item.id} style={styles.historyItem}>
                    <div style={styles.historyDate}>{new Date(item.createdAt).toLocaleString()}</div>
                    <div style={styles.historyMeta}>Durată: {formatSeconds(item.totalDurationSeconds)}</div>
                    <div style={styles.historyMeta}>Runde: {item.roundsCompleted} • Respirații: {item.breathsPerRound}</div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    );
  }

  function renderAbout() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}
          <h1 style={styles.title}>Despre aplicație</h1>
          <div style={styles.card}>
            <p style={styles.safetyText}>{SAFETY_MESSAGE}</p>
          </div>
        </div>
      </div>
    );
  }

  function renderHome() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}
          <h1 style={styles.title}>Configurare sesiune</h1>
          <p style={styles.subtitle}>Ajustează parametrii sesiunii înainte să pornești exercițiul.</p>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Setări sesiune</div>

            <Stepper
              label="Runde"
              value={settings.rounds}
              min={1}
              max={10}
              onMinus={() => updateNumericSetting('rounds', -1, 1, 10)}
              onPlus={() => updateNumericSetting('rounds', 1, 1, 10)}
            />

            <Stepper
              label="Respirații / rundă"
              value={settings.breathsPerRound}
              min={10}
              max={60}
              onMinus={() => updateNumericSetting('breathsPerRound', -5, 10, 60)}
              onPlus={() => updateNumericSetting('breathsPerRound', 5, 10, 60)}
            />

            <Stepper
              label="Recuperare"
              value={settings.recoverySeconds}
              min={5}
              max={30}
              suffix="s"
              onMinus={() => updateNumericSetting('recoverySeconds', -5, 5, 30)}
              onPlus={() => updateNumericSetting('recoverySeconds', 5, 5, 30)}
            />

            <div style={styles.settingRow}>
              <div style={styles.settingLabel}>Ritm respirație</div>
              <div style={styles.segmentWrap}>
                {['slow', 'medium', 'fast'].map(speed => (
                  <button
                    key={speed}
                    style={{
                      ...styles.segmentButton,
                      ...(settings.breathingPace === speed ? styles.segmentButtonActive : {}),
                    }}
                    onClick={() => persistSettings({ ...settings, breathingPace: speed })}
                  >
                    <span
                      style={{
                        ...styles.segmentButtonText,
                        ...(settings.breathingPace === speed ? styles.segmentButtonTextActive : {}),
                      }}
                    >
                      {speed === 'slow' ? 'Lent' : speed === 'medium' ? 'Mediu' : 'Rapid'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Toggle
              label="Vibrații"
              checked={settings.vibrationEnabled}
              onChange={value => persistSettings({ ...settings, vibrationEnabled: value })}
            />

            <Toggle
              label="Sunet"
              checked={settings.soundEnabled}
              onChange={async value => {
                persistSettings({ ...settings, soundEnabled: value });
                if (value) {
                  await safePlayTone(true, audioContextRef, 'light');
                }
              }}
            />

            <Toggle
              label="Timer retenție vizibil"
              checked={settings.showHoldTimer}
              onChange={value => persistSettings({ ...settings, showHoldTimer: value })}
            />

            <div style={styles.helperText}>
              Sunetul în browser pornește doar după o interacțiune explicită și poate fi foarte discret pe unele dispozitive.
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Siguranță</div>
            <p style={styles.safetyText}>{SAFETY_MESSAGE}</p>
          </div>

          <button style={styles.primaryButton} onClick={startSession}>Start sesiune</button>
        </div>
      </div>
    );
  }

  function renderSession() {
    return (
      <div style={styles.pageWrap}>
        <div style={{ ...styles.pageInner, ...styles.sessionPageInner }}>
          {renderHeader()}
          <BreathCircle phase={phase} inhale={inhale} recoveryProgress={recoveryProgress} breathingDuration={breathingDuration} breathCount={breathCount} breathsPerRound={breathsPerRound} />
          <div style={styles.sessionInstruction}>{currentInstruction}</div>
          <div style={styles.sessionActions}>
            {phase === PHASES.BREATHING && <button style={styles.primaryButton} onClick={skipBreathingToHold}>Treci la retenție</button>}
            {phase === PHASES.HOLD && <button style={styles.primaryButton} onClick={finishHoldAndStartRecovery}>Respir acum</button>}
            <button style={styles.ghostButton} onClick={cancelSession}>Închide</button>
          </div>
        </div>
      </div>
    );
  }

  function renderSummary() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}
          <h1 style={styles.title}>Rezumat</h1>
        </div>
      </div>
    );
  }

  function renderHistory() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}
          <h1 style={styles.title}>Istoric sesiuni</h1>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Toate sesiunile</div>

            {history.length === 0 ? (
              <div style={styles.emptyText}>Nu există sesiuni salvate încă.</div>
            ) : (
              history.map(item => (
                <div key={item.id} style={styles.historyItem}>
                  <div style={styles.historyDate}>{new Date(item.createdAt).toLocaleString()}</div>
                  <div style={styles.historyMeta}>Durată: {formatSeconds(item.totalDurationSeconds)}</div>
                  <div style={styles.historyMeta}>Runde: {item.roundsCompleted} / {item.roundsPlanned}</div>
                  <div style={styles.historyMeta}>Respirații: {item.breathsPerRound}</div>
                  <div style={styles.historyMeta}>
                    Max retenție: {formatSeconds(Math.max(...(item.retentionTimes || [0])))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-root theme-${settings.theme}`}>
      <style>{globalCss}</style>
      {screen === 'dashboard' && renderDashboard()}
      {screen === 'about' && renderAbout()}
      {screen === 'home' && renderHome()}
      {screen === 'session' && renderSession()}
      {screen === 'summary' && renderSummary()}
      {screen === 'history' && renderHistory()}
    </div>
  );
}

const styles = {
  pageWrap: {
    minHeight: '100dvh',
    background: 'var(--bg)',
    color: 'var(--text-primary)',
    padding: '16px',
  },
  pageInner: {
    maxWidth: '760px',
    margin: '0 auto',
  },
  headerShell: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    marginBottom: '16px',
    padding: '12px',
    borderRadius: '20px',
    background: 'var(--card-bg)',
    border: '1px solid var(--border-color)',
    boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
  },
  headerTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px',
  },
  headerBrandButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'none',
    border: 'none',
    fontWeight: 800,
    color: 'var(--text-strong)',
    fontSize: 16,
    cursor: 'pointer',
  },
  headerBrandDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: 'var(--accent)',
  },
  headerNavRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4,1fr)',
    gap: '8px',
  },
  headerNavButton: {
    padding: '10px',
    borderRadius: '12px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    fontWeight: 700,
    cursor: 'pointer',
  },
  themeSwitchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 8px',
    borderRadius: '999px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-color)',
    minHeight: 44,
  },
  themeSwitchLabel: {
    fontSize: 12,
  },
  themeIcon: {
    fontSize: 18,
  },
  heroCard: {
    background: 'var(--card-bg)',
    padding: '20px',
    borderRadius: '20px',
    marginBottom: '16px',
    border: '1px solid var(--border-color)',
    boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
  },
  wakeLockBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '999px',
    background: 'var(--surface-2)',
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 8,
  },
  heroTopLine: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    color: 'var(--text-strong)',
    margin: '0 0 6px',
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--text-primary)',
    opacity: 0.78,
    margin: '0 0 12px',
    lineHeight: 1.55,
  },
  dashboardActionGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3,1fr)',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    background: 'var(--card-bg)',
    padding: 14,
    borderRadius: 16,
    textAlign: 'center',
    border: '1px solid var(--border-color)',
  },
  statValue: { fontSize: 20, fontWeight: 800, color: 'var(--text-strong)' },
  statLabel: { fontSize: 12, opacity: 0.75 },
  dashboardGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
  },
  card: {
    background: 'var(--card-bg)',
    padding: 16,
    borderRadius: 20,
    border: '1px solid var(--border-color)',
    boxShadow: '0 10px 24px rgba(0,0,0,0.10)',
  },
  cardTitle: {
    fontWeight: 800,
    marginBottom: 14,
    color: 'var(--text-strong)',
    fontSize: 18,
  },
  settingRow: {
    marginBottom: 14,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 8,
  },
  stepperWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    background: 'var(--surface-2)',
    border: '1px solid var(--border-color)',
    borderRadius: 16,
    padding: '10px 12px',
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontWeight: 800,
    fontSize: 24,
    cursor: 'pointer',
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 800,
    color: 'var(--text-strong)',
  },
  segmentWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  },
  segmentButton: {
    border: '1px solid var(--border-color)',
    background: 'var(--surface-2)',
    borderRadius: 14,
    padding: '12px 10px',
    cursor: 'pointer',
  },
  segmentButtonActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  segmentButtonTextActive: {
    color: '#fff',
  },
  toggleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    padding: '10px 12px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-color)',
    borderRadius: 16,
  },
  toggleLabelWrap: {
    flex: 1,
    minWidth: 0,
  },
  primaryButton: {
    width: '100%',
    background: 'var(--accent)',
    color: '#fff',
    padding: 14,
    borderRadius: 14,
    border: 'none',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 10px 20px rgba(124,58,237,0.22)',
  },
  secondaryButtonWide: {
    background: 'var(--surface-2)',
    color: 'var(--text-primary)',
    padding: 14,
    borderRadius: 14,
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
  },
  historyItem: {
    padding: '10px 0',
    borderBottom: '1px solid var(--border-color)',
  },
  historyDate: { fontWeight: 700, color: 'var(--text-strong)' },
  historyMeta: { fontSize: 12, opacity: 0.7 },
  emptyText: { opacity: 0.6 },
  circleContainer: { display: 'flex', justifyContent: 'center' },
  circle: {
    background: 'radial-gradient(circle at 30% 30%, #a78bfa, var(--accent))',
    transition: 'all 0.25s ease',
    willChange: 'transform, box-shadow',
  },
  circleContent: {
    textAlign: 'center',
    color: '#fff',
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 0,
    paddingBottom: 0,
  },
  circleCount: { fontSize: 32, fontWeight: 800 },
  circleCountLabel: { fontSize: 12 },
  sessionInstruction: { textAlign: 'center', fontSize: 22, fontWeight: 800, color: 'var(--text-strong)' },
  sessionActions: { display: 'grid', gap: 10 },
  ghostButton: { background: 'none', border: 'none', opacity: 0.6, color: 'var(--text-primary)', cursor: 'pointer' },
  helperText: {
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--text-primary)',
    opacity: 0.68,
    marginTop: -4,
  },
  safetyText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: 'var(--text-primary)',
    opacity: 0.85,
    margin: 0,
  },
  switch: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    minWidth: 56,
    minHeight: 36,
    padding: 2,
    touchAction: 'manipulation',
    position: 'relative',
  },
  switchInput: {
    position: 'absolute',
    opacity: 0,
    width: '100%',
    height: '100%',
    cursor: 'pointer',
  },
  switchTrack: {
    width: 52,
    height: 32,
    background: 'var(--surface-2)',
    borderRadius: 999,
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid var(--border-color)',
    transition: 'all 0.2s ease',
  },
  switchTrackActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  switchThumb: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    left: 3,
    top: 2,
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
  },
  switchThumbActive: {
    left: 23,
  },
};

const globalCss = `
  @keyframes breatheIn {
    0% { transform: scale(0.85); box-shadow: 0 0 0 rgba(124,58,237,0.2); }
    50% { box-shadow: 0 0 40px rgba(124,58,237,0.35); }
    100% { transform: scale(1.05); box-shadow: 0 0 80px rgba(124,58,237,0.5); }
  }

  @keyframes breatheOut {
    0% { transform: scale(1.05); box-shadow: 0 0 80px rgba(124,58,237,0.5); }
    50% { box-shadow: 0 0 30px rgba(124,58,237,0.3); }
    100% { transform: scale(0.85); box-shadow: 0 0 0 rgba(124,58,237,0.2); }
  }

  .theme-dark .wake-lock-dot,
  .theme-light .wake-lock-dot { display:none; }

  :root {
    --bg:#0f172a;
    --card-bg:#1e293b;
    --text-primary:#e2e8f0;
    --text-strong:#fff;
    --surface-2:#334155;
    --border-color:#475569;
    --accent:#7c3aed;
  }
  .theme-light {
    --bg:#f1f5f9;
    --card-bg:#fff;
    --text-primary:#0f172a;
    --text-strong:#000;
    --surface-2:#e2e8f0;
    --border-color:#cbd5f5;
    --accent:#7c3aed;
  }
`;
import React, { useEffect, useMemo, useRef, useState } from 'react';

const STORAGE_KEYS = {
  SETTINGS: 'breathing_app_settings_v1',
  HISTORY: 'breathing_app_history_v1',
  SAFETY_ACK: 'breathing_app_safety_ack_v1',
};

const PHASES = {
  IDLE: 'idle',
  BREATHING: 'breathing',
  HOLD: 'hold',
  RECOVERY: 'recovery',
  PAUSED: 'paused',
  COMPLETED: 'completed',
};

const DEFAULT_SETTINGS = {
  rounds: 3,
  breathsPerRound: 30,
  recoverySeconds: 15,
  soundEnabled: false,
  vibrationEnabled: true,
  showHoldTimer: true,
  breathingPace: 'medium',
  theme: 'dark',
};

const BREATHING_SPEEDS = {
  slow: 2600,
  medium: 2000,
  fast: 1400,
};

const SAFETY_MESSAGE =
  'Nu practica exercițiile de respirație în apă, în timp ce conduci sau în orice situație în care pierderea atenției poate deveni periculoasă. Oprește sesiunea dacă apar amețeală, disconfort sau stare de rău.';

function formatSeconds(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getPhaseTitle(phase) {
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

function getPhaseInstruction(phase, inhale) {
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

async function safeVibrate(enabled, type = 'light') {
  if (!enabled || typeof navigator === 'undefined' || !navigator.vibrate) return;
  const patterns = { light: 30, warning: [80, 60, 80], success: [40, 30, 40, 30, 40] };
  try { navigator.vibrate(patterns[type] || patterns.light); } catch {}
}

function createBeep(audioContext, frequency = 660, duration = 0.12, volume = 0.03, type = 'sine') {
  if (!audioContext) return;
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

async function safePlayTone(enabled, audioContextRef, type = 'light') {
  if (!enabled || typeof window === 'undefined') return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    if (!audioContextRef.current) audioContextRef.current = new AudioContextClass();
    const audioContext = audioContextRef.current;
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (type === 'warning') {
      createBeep(audioContext, 520, 0.14, 0.035, 'triangle');
      setTimeout(() => createBeep(audioContext, 420, 0.16, 0.03, 'triangle'), 160);
      return;
    }
    if (type === 'success') {
      createBeep(audioContext, 540, 0.1, 0.03, 'sine');
      setTimeout(() => createBeep(audioContext, 680, 0.12, 0.035, 'sine'), 120);
      return;
    }
    createBeep(audioContext, 660, 0.08, 0.025, 'sine');
  } catch {}
}

function readStorage(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

function writeStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function Stepper({ label, value, onMinus, onPlus, min = 1, max = 99, suffix = '' }) {
  return (
    <div style={styles.settingRow}>
      <div style={styles.settingLabel}>{label}</div>
      <div style={styles.stepperWrap}>
        <button onClick={onMinus} style={styles.stepperButton} disabled={value <= min}>−</button>
        <div style={styles.stepperValue}>{value}{suffix}</div>
        <button onClick={onPlus} style={styles.stepperButton} disabled={value >= max}>+</button>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <div style={styles.toggleRow}>
      <div style={styles.toggleLabelWrap}>
        <div style={{ ...styles.settingLabel, marginBottom: 0 }}>{label}</div>
      </div>
      <label style={styles.switch}>
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={styles.switchInput} />
        <span style={{ ...styles.switchTrack, ...(checked ? styles.switchTrackActive : {}) }}>
          <span style={{ ...styles.switchThumb, ...(checked ? styles.switchThumbActive : {}) }} />
        </span>
      </label>
    </div>
  );
}

function BreathCircle({ phase, inhale, recoveryProgress, breathingDuration, breathCount, breathsPerRound }) {
  const isBreathing = phase === PHASES.BREATHING;
  const size = isBreathing ? 220 : phase === PHASES.RECOVERY ? 210 : 190;
  const opacity = phase === PHASES.HOLD ? 0.7 : 1;
  const scale = phase === PHASES.RECOVERY ? 0.95 + recoveryProgress * 0.05 : 1;
  const animationName = inhale ? 'breatheIn' : 'breatheOut';

  return (
    <div style={styles.circleContainer}>
      <div
        style={{
          ...styles.circle,
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity,
          transform: `scale(${scale})`,
          animation: isBreathing ? `${animationName} ${breathingDuration}ms linear forwards` : 'none',
        }}
      >
        {isBreathing ? (
          <div style={styles.circleContent}>
            <div style={styles.circleCount}>{breathCount}</div>
            <div style={styles.circleCountLabel}>din {breathsPerRound} respirații</div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('dashboard');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [history, setHistory] = useState([]);
  const [safetyAccepted, setSafetyAccepted] = useState(false);

  const [phase, setPhase] = useState(PHASES.IDLE);
  const [previousPhase, setPreviousPhase] = useState(PHASES.IDLE);
  const [round, setRound] = useState(1);
  const [totalRounds, setTotalRounds] = useState(DEFAULT_SETTINGS.rounds);
  const [breathCount, setBreathCount] = useState(0);
  const [breathsPerRound, setBreathsPerRound] = useState(DEFAULT_SETTINGS.breathsPerRound);
  const [inhale, setInhale] = useState(true);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [recoverySecondsLeft, setRecoverySecondsLeft] = useState(DEFAULT_SETTINGS.recoverySeconds);
  const [retentions, setRetentions] = useState([]);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [notice, setNotice] = useState('');
  const [wakeLockEnabled, setWakeLockEnabled] = useState(false);

  const breathIntervalRef = useRef(null);
  const audioContextRef = useRef(null);
  const secondIntervalRef = useRef(null);
  const phaseRef = useRef(PHASES.IDLE);
  const inhaleRef = useRef(true);
  const holdSecondsRef = useRef(0);
  const retentionsRef = useRef([]);
  const historyRef = useRef([]);
  const sessionStartedAtRef = useRef(null);
  const transitionLockRef = useRef(false);
  const wakeLockRef = useRef(null);

  useEffect(() => {
    const savedSettings = readStorage(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS);
    const savedHistory = readStorage(STORAGE_KEYS.HISTORY, []);
    const savedSafety = readStorage(STORAGE_KEYS.SAFETY_ACK, false);
    setSettings({ ...DEFAULT_SETTINGS, ...savedSettings });
    setHistory(Array.isArray(savedHistory) ? savedHistory : []);
    setSafetyAccepted(savedSafety === true);
  }, []);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { inhaleRef.current = inhale; }, [inhale]);
  useEffect(() => { holdSecondsRef.current = holdSeconds; }, [holdSeconds]);
  useEffect(() => { retentionsRef.current = retentions; }, [retentions]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { sessionStartedAtRef.current = sessionStartedAt; }, [sessionStartedAt]);

  useEffect(() => () => {
    clearBreathingLoop();
    clearSecondLoop();
    releaseWakeLock();
    if (audioContextRef.current?.close) audioContextRef.current.close().catch(() => {});
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY].includes(phaseRef.current)) {
        pauseSession(true);
        return;
      }

      if (!document.hidden && [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY, PHASES.PAUSED].includes(phaseRef.current)) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  useEffect(() => {
    if (phase === PHASES.BREATHING) startBreathingLoop(); else clearBreathingLoop();
    if (phase === PHASES.HOLD) startHoldTimer(); else if (phase === PHASES.RECOVERY) startRecoveryTimer(); else clearSecondLoop();

    if ([PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY, PHASES.PAUSED].includes(phase)) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    return () => { clearBreathingLoop(); clearSecondLoop(); };
  }, [phase]);

  function persistSettings(next) { setSettings(next); writeStorage(STORAGE_KEYS.SETTINGS, next); }

  async function requestWakeLock() {
    try {
      if (typeof navigator === 'undefined' || !navigator.wakeLock || wakeLockRef.current) return false;
      wakeLockRef.current = await navigator.wakeLock.request('screen');
      wakeLockRef.current.addEventListener?.('release', () => {
        wakeLockRef.current = null;
        setWakeLockEnabled(false);
      });
      setWakeLockEnabled(true);
      return true;
    } catch {
      setWakeLockEnabled(false);
      return false;
    }
  }

  async function releaseWakeLock() {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
      }
    } catch {}
    setWakeLockEnabled(false);
  }
  function persistHistory(next) { setHistory(next); writeStorage(STORAGE_KEYS.HISTORY, next); }

  function clearBreathingLoop() { if (breathIntervalRef.current) { clearInterval(breathIntervalRef.current); breathIntervalRef.current = null; } }
  function clearSecondLoop() { if (secondIntervalRef.current) { clearInterval(secondIntervalRef.current); secondIntervalRef.current = null; } }

  function resetSessionState() {
    clearBreathingLoop(); clearSecondLoop(); releaseWakeLock(); transitionLockRef.current = false;
    setPhase(PHASES.IDLE); setPreviousPhase(PHASES.IDLE); setRound(1); setBreathCount(0);
    setInhale(true); setHoldSeconds(0); setRecoverySecondsLeft(settings.recoverySeconds);
    setRetentions([]); setSessionStartedAt(null); setSessionDuration(0);
  }

  async function playFeedback(type = 'light') {
    await Promise.all([ safeVibrate(settings.vibrationEnabled, type), safePlayTone(settings.soundEnabled, audioContextRef, type) ]);
  }

  async function startSession(forceStart = false) {
    if (!safetyAccepted && !forceStart) { setShowSafetyModal(true); return; }
    transitionLockRef.current = false; setShowSafetyModal(false); setNotice('');
    setTotalRounds(settings.rounds); setBreathsPerRound(settings.breathsPerRound);
    setRecoverySecondsLeft(settings.recoverySeconds); setRound(1); setBreathCount(0);
    setHoldSeconds(0); setRetentions([]); setSessionStartedAt(Date.now()); setSessionDuration(0);
    setInhale(true); setPhase(PHASES.BREATHING); setScreen('session'); await playFeedback('light');
  }

  function startBreathingLoop() {
    clearBreathingLoop(); transitionLockRef.current = false;
    const interval = BREATHING_SPEEDS[settings.breathingPace] || BREATHING_SPEEDS.medium;
    breathIntervalRef.current = setInterval(() => {
      const wasInhale = inhaleRef.current;
      const nextInhale = !wasInhale;
      inhaleRef.current = nextInhale; setInhale(nextInhale);
      if (!wasInhale) {
        setBreathCount(prev => {
          const updated = prev + 1;
          if (updated >= breathsPerRound && !transitionLockRef.current) {
            transitionLockRef.current = true; setTimeout(() => moveToHold(), 50);
          }
          return updated;
        });
      }
      playFeedback('light');
    }, interval);
  }

  async function moveToHold() {
    if (phaseRef.current !== PHASES.BREATHING) return;
    clearBreathingLoop(); transitionLockRef.current = true; setHoldSeconds(0);
    setInhale(true); inhaleRef.current = true; setPhase(PHASES.HOLD);
    await playFeedback('warning');
  }

  function skipBreathingToHold() { if (phaseRef.current !== PHASES.BREATHING) return; moveToHold(); }

  function startHoldTimer() { clearSecondLoop(); secondIntervalRef.current = setInterval(() => setHoldSeconds(p => p + 1), 1000); }

  function finishHoldAndStartRecovery() {
    clearSecondLoop(); const holdValue = holdSecondsRef.current;
    setRetentions(prev => { const next = [...prev, holdValue]; retentionsRef.current = next; return next; });
    setRecoverySecondsLeft(settings.recoverySeconds); setPhase(PHASES.RECOVERY); playFeedback('light');
  }

  function startRecoveryTimer() {
    clearSecondLoop();
    secondIntervalRef.current = setInterval(() => {
      setRecoverySecondsLeft(prev => {
        if (prev <= 1) { clearSecondLoop(); setTimeout(() => finishRecovery(), 50); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  async function finishRecovery() {
    await playFeedback('success');
    if (round >= totalRounds) { completeSession(); return; }
    transitionLockRef.current = false; setRound(r => r + 1); setBreathCount(0);
    setHoldSeconds(0); setRecoverySecondsLeft(settings.recoverySeconds); setInhale(true); setPhase(PHASES.BREATHING);
  }

  function completeSession() {
    clearBreathingLoop(); clearSecondLoop(); releaseWakeLock(); transitionLockRef.current = false;
    const endedAt = Date.now(); const startedAt = sessionStartedAtRef.current;
    const finalRetentions = retentionsRef.current;
    const totalDurationSeconds = startedAt ? Math.max(0, Math.floor((endedAt - startedAt) / 1000)) : 0;
    const sessionRecord = {
      id: String(Date.now()), createdAt: new Date().toISOString(),
      roundsPlanned: totalRounds, roundsCompleted: totalRounds, breathsPerRound,
      recoverySeconds: settings.recoverySeconds, retentionTimes: finalRetentions,
      totalDurationSeconds, completed: true,
    };
    const nextHistory = [sessionRecord, ...historyRef.current].slice(0, 50);
    persistHistory(nextHistory);
    setSessionDuration(totalDurationSeconds); setRetentions(finalRetentions);
    setPhase(PHASES.COMPLETED); setScreen('summary');
  }

  function pauseSession(fromBackground = false) {
    if (![PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY].includes(phaseRef.current)) return;
    setPreviousPhase(phaseRef.current); clearBreathingLoop(); clearSecondLoop(); setPhase(PHASES.PAUSED);
    if (fromBackground) setNotice('Sesiunea a fost pusă pe pauză deoarece tab-ul a devenit inactiv.');
  }

  function resumeSession() { if (phase !== PHASES.PAUSED) return; setPhase(previousPhase || PHASES.BREATHING); }
  function cancelSession() {
    // direct close (no modal)
    resetSessionState();
    setScreen('dashboard');
  }
  function confirmCancelSession() { setShowCancelModal(false); resetSessionState(); setScreen('home'); }

  function updateNumericSetting(key, delta, min, max) {
    const nextValue = Math.max(min, Math.min(max, settings[key] + delta));
    persistSettings({ ...settings, [key]: nextValue });
  }

  const breathingDuration = useMemo(() => BREATHING_SPEEDS[settings.breathingPace] || BREATHING_SPEEDS.medium, [settings.breathingPace]);
  const currentInstruction = useMemo(() => getPhaseInstruction(phase, inhale), [phase, inhale]);
  const recoveryProgress = useMemo(() => (settings.recoverySeconds - recoverySecondsLeft) / Math.max(1, settings.recoverySeconds), [settings.recoverySeconds, recoverySecondsLeft]);

  const bestRetention = history.length ? Math.max(...history.flatMap(i => i.retentionTimes || [0]), 0) : 0;
  const retentionValues = history.flatMap(i => i.retentionTimes || []);
  const averageRetention = retentionValues.length ? Math.round(retentionValues.reduce((s, v) => s + v, 0) / retentionValues.length) : 0;

  function renderHeader() {
    return (
      <div style={styles.headerShell}>
        <div style={styles.headerTopRow}>
          <button style={styles.headerBrandButton} onClick={() => setScreen('dashboard')}>
            <span style={styles.headerBrandDot} />
            <span>Respirație 3 faze</span>
          </button>
          <label style={styles.themeSwitchWrap} aria-label="Schimbă tema">
            <span style={styles.themeIcon}>{settings.theme === 'dark' ? '🌙' : '☀️'}</span>
            <span style={styles.switch}>
              <input
                type="checkbox"
                checked={settings.theme === 'light'}
                onChange={e => persistSettings({ ...settings, theme: e.target.checked ? 'light' : 'dark' })}
                style={styles.switchInput}
              />
              <span style={{ ...styles.switchTrack, ...(settings.theme === 'light' ? styles.switchTrackActive : {}) }}>
                <span style={{ ...styles.switchThumb, ...(settings.theme === 'light' ? styles.switchThumbActive : {}) }} />
              </span>
            </span>
          </label>
        </div>
        <div style={styles.headerNavRow} data-header-actions="true">
          <button style={styles.headerNavButton} onClick={() => setScreen('dashboard')}>Dashboard</button>
          <button style={styles.headerNavButton} onClick={() => setScreen('home')}>Configurare</button>
          <button style={styles.headerNavButton} onClick={() => setScreen('about')}>Despre</button>
          <button style={styles.headerNavButton} onClick={() => setScreen('history')}>Istoric</button>
        </div>
      </div>
    );
  }

  function renderDashboard() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}

          <div style={styles.heroCard}>
            <div style={styles.wakeLockBadge}>{wakeLockEnabled ? 'Ecran activ' : 'Ecran normal'}</div>
            <div style={styles.heroTopLine}>Dashboard</div>
            <h1 style={styles.title}>Respirație în 3 faze</h1>
            <p style={styles.subtitle}>Pornește rapid o sesiune și vezi progresul.</p>
            <div style={styles.dashboardActionGrid} data-dashboard-actions="true">
              <button style={styles.primaryButton} onClick={startSession}>Start sesiune</button>
              <button style={styles.secondaryButtonWide} onClick={() => setScreen('home')}>Configurare sesiune</button>
            </div>
          </div>

          <div style={styles.statsGrid} data-stats-grid="true">
            <div style={styles.statCard}>
              <div style={styles.statValue}>{history.length}</div>
              <div style={styles.statLabel}>Sesiuni totale</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{formatSeconds(bestRetention)}</div>
              <div style={styles.statLabel}>Record retenție</div>
            </div>
            <div style={styles.statCard}>
              <div style={styles.statValue}>{formatSeconds(averageRetention)}</div>
              <div style={styles.statLabel}>Medie retenții</div>
            </div>
          </div>

          <div style={styles.dashboardGrid} data-dashboard-grid="true">
            <div style={styles.card}>
              <div style={styles.cardTitle}>Istoric sesiuni</div>
              {history.length === 0 ? (
                <div style={styles.emptyText}>Nu există sesiuni salvate încă.</div>
              ) : (
                history.map(item => (
                  <div key={item.id} style={styles.historyItem}>
                    <div style={styles.historyDate}>{new Date(item.createdAt).toLocaleString()}</div>
                    <div style={styles.historyMeta}>Durată: {formatSeconds(item.totalDurationSeconds)}</div>
                    <div style={styles.historyMeta}>Runde: {item.roundsCompleted} • Respirații: {item.breathsPerRound}</div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    );
  }

  function renderAbout() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}
          <h1 style={styles.title}>Despre aplicație</h1>
          <div style={styles.card}>
            <p style={styles.safetyText}>{SAFETY_MESSAGE}</p>
          </div>
        </div>
      </div>
    );
  }

  function renderHome() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}
          <h1 style={styles.title}>Configurare sesiune</h1>
          <p style={styles.subtitle}>Ajustează parametrii sesiunii înainte să pornești exercițiul.</p>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Setări sesiune</div>

            <Stepper
              label="Runde"
              value={settings.rounds}
              min={1}
              max={10}
              onMinus={() => updateNumericSetting('rounds', -1, 1, 10)}
              onPlus={() => updateNumericSetting('rounds', 1, 1, 10)}
            />

            <Stepper
              label="Respirații / rundă"
              value={settings.breathsPerRound}
              min={10}
              max={60}
              onMinus={() => updateNumericSetting('breathsPerRound', -5, 10, 60)}
              onPlus={() => updateNumericSetting('breathsPerRound', 5, 10, 60)}
            />

            <Stepper
              label="Recuperare"
              value={settings.recoverySeconds}
              min={5}
              max={30}
              suffix="s"
              onMinus={() => updateNumericSetting('recoverySeconds', -5, 5, 30)}
              onPlus={() => updateNumericSetting('recoverySeconds', 5, 5, 30)}
            />

            <div style={styles.settingRow}>
              <div style={styles.settingLabel}>Ritm respirație</div>
              <div style={styles.segmentWrap}>
                {['slow', 'medium', 'fast'].map(speed => (
                  <button
                    key={speed}
                    style={{
                      ...styles.segmentButton,
                      ...(settings.breathingPace === speed ? styles.segmentButtonActive : {}),
                    }}
                    onClick={() => persistSettings({ ...settings, breathingPace: speed })}
                  >
                    <span
                      style={{
                        ...styles.segmentButtonText,
                        ...(settings.breathingPace === speed ? styles.segmentButtonTextActive : {}),
                      }}
                    >
                      {speed === 'slow' ? 'Lent' : speed === 'medium' ? 'Mediu' : 'Rapid'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Toggle
              label="Vibrații"
              checked={settings.vibrationEnabled}
              onChange={value => persistSettings({ ...settings, vibrationEnabled: value })}
            />

            <Toggle
              label="Sunet"
              checked={settings.soundEnabled}
              onChange={async value => {
                persistSettings({ ...settings, soundEnabled: value });
                if (value) {
                  await safePlayTone(true, audioContextRef, 'light');
                }
              }}
            />

            <Toggle
              label="Timer retenție vizibil"
              checked={settings.showHoldTimer}
              onChange={value => persistSettings({ ...settings, showHoldTimer: value })}
            />

            <div style={styles.helperText}>
              Sunetul în browser pornește doar după o interacțiune explicită și poate fi foarte discret pe unele dispozitive.
            </div>
          </div>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Siguranță</div>
            <p style={styles.safetyText}>{SAFETY_MESSAGE}</p>
          </div>

          <button style={styles.primaryButton} onClick={startSession}>Start sesiune</button>
        </div>
      </div>
    );
  }

  function renderSession() {
    return (
      <div style={styles.pageWrap}>
        <div style={{ ...styles.pageInner, ...styles.sessionPageInner }}>
          {renderHeader()}
          <BreathCircle phase={phase} inhale={inhale} recoveryProgress={recoveryProgress} breathingDuration={breathingDuration} breathCount={breathCount} breathsPerRound={breathsPerRound} />
          <div style={styles.sessionInstruction}>{currentInstruction}</div>
          <div style={styles.sessionActions}>
            {phase === PHASES.BREATHING && <button style={styles.primaryButton} onClick={skipBreathingToHold}>Treci la retenție</button>}
            {phase === PHASES.HOLD && <button style={styles.primaryButton} onClick={finishHoldAndStartRecovery}>Respir acum</button>}
            <button style={styles.ghostButton} onClick={cancelSession}>Închide</button>
          </div>
        </div>
      </div>
    );
  }

  function renderSummary() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}
          <h1 style={styles.title}>Rezumat</h1>
        </div>
      </div>
    );
  }

  function renderHistory() {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.pageInner}>
          {renderHeader()}
          <h1 style={styles.title}>Istoric sesiuni</h1>

          <div style={styles.card}>
            <div style={styles.cardTitle}>Toate sesiunile</div>

            {history.length === 0 ? (
              <div style={styles.emptyText}>Nu există sesiuni salvate încă.</div>
            ) : (
              history.map(item => (
                <div key={item.id} style={styles.historyItem}>
                  <div style={styles.historyDate}>{new Date(item.createdAt).toLocaleString()}</div>
                  <div style={styles.historyMeta}>Durată: {formatSeconds(item.totalDurationSeconds)}</div>
                  <div style={styles.historyMeta}>Runde: {item.roundsCompleted} / {item.roundsPlanned}</div>
                  <div style={styles.historyMeta}>Respirații: {item.breathsPerRound}</div>
                  <div style={styles.historyMeta}>
                    Max retenție: {formatSeconds(Math.max(...(item.retentionTimes || [0])))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-root theme-${settings.theme}`}>
      <style>{globalCss}</style>
      {screen === 'dashboard' && renderDashboard()}
      {screen === 'about' && renderAbout()}
      {screen === 'home' && renderHome()}
      {screen === 'session' && renderSession()}
      {screen === 'summary' && renderSummary()}
      {screen === 'history' && renderHistory()}
    </div>
  );
}

const styles = {
  pageWrap: {
    minHeight: '100dvh',
    background: 'var(--bg)',
    color: 'var(--text-primary)',
    padding: '16px',
  },
  pageInner: {
    maxWidth: '760px',
    margin: '0 auto',
  },
  headerShell: {
    position: 'sticky',
    top: 0,
    zIndex: 20,
    marginBottom: '16px',
    padding: '12px',
    borderRadius: '20px',
    background: 'var(--card-bg)',
    border: '1px solid var(--border-color)',
    boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
  },
  headerTopRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '10px',
  },
  headerBrandButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'none',
    border: 'none',
    fontWeight: 800,
    color: 'var(--text-strong)',
    fontSize: 16,
    cursor: 'pointer',
  },
  headerBrandDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: 'var(--accent)',
  },
  headerNavRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4,1fr)',
    gap: '8px',
  },
  headerNavButton: {
    padding: '10px',
    borderRadius: '12px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
    fontWeight: 700,
    cursor: 'pointer',
  },
  themeSwitchWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 8px',
    borderRadius: '999px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-color)',
    minHeight: 44,
  },
  themeSwitchLabel: {
    fontSize: 12,
  },
  themeIcon: {
    fontSize: 18,
  },
  heroCard: {
    background: 'var(--card-bg)',
    padding: '20px',
    borderRadius: '20px',
    marginBottom: '16px',
    border: '1px solid var(--border-color)',
    boxShadow: '0 10px 24px rgba(0,0,0,0.12)',
  },
  wakeLockBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '999px',
    background: 'var(--surface-2)',
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 8,
  },
  heroTopLine: {
    fontSize: 12,
    opacity: 0.7,
    marginBottom: 6,
  },
  title: {
    fontSize: 28,
    fontWeight: 800,
    color: 'var(--text-strong)',
    margin: '0 0 6px',
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--text-primary)',
    opacity: 0.78,
    margin: '0 0 12px',
    lineHeight: 1.55,
  },
  dashboardActionGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 10,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3,1fr)',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    background: 'var(--card-bg)',
    padding: 14,
    borderRadius: 16,
    textAlign: 'center',
    border: '1px solid var(--border-color)',
  },
  statValue: { fontSize: 20, fontWeight: 800, color: 'var(--text-strong)' },
  statLabel: { fontSize: 12, opacity: 0.75 },
  dashboardGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
  },
  card: {
    background: 'var(--card-bg)',
    padding: 16,
    borderRadius: 20,
    border: '1px solid var(--border-color)',
    boxShadow: '0 10px 24px rgba(0,0,0,0.10)',
  },
  cardTitle: {
    fontWeight: 800,
    marginBottom: 14,
    color: 'var(--text-strong)',
    fontSize: 18,
  },
  settingRow: {
    marginBottom: 14,
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: 'var(--text-primary)',
    marginBottom: 8,
  },
  stepperWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    background: 'var(--surface-2)',
    border: '1px solid var(--border-color)',
    borderRadius: 16,
    padding: '10px 12px',
  },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontWeight: 800,
    fontSize: 24,
    cursor: 'pointer',
  },
  stepperValue: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 800,
    color: 'var(--text-strong)',
  },
  segmentWrap: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
    gap: 10,
  },
  segmentButton: {
    border: '1px solid var(--border-color)',
    background: 'var(--surface-2)',
    borderRadius: 14,
    padding: '12px 10px',
    cursor: 'pointer',
  },
  segmentButtonActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: 700,
    color: 'var(--text-primary)',
  },
  segmentButtonTextActive: {
    color: '#fff',
  },
  toggleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    padding: '10px 12px',
    background: 'var(--surface-2)',
    border: '1px solid var(--border-color)',
    borderRadius: 16,
  },
  toggleLabelWrap: {
    flex: 1,
    minWidth: 0,
  },
  primaryButton: {
    width: '100%',
    background: 'var(--accent)',
    color: '#fff',
    padding: 14,
    borderRadius: 14,
    border: 'none',
    fontWeight: 800,
    cursor: 'pointer',
    boxShadow: '0 10px 20px rgba(124,58,237,0.22)',
  },
  secondaryButtonWide: {
    background: 'var(--surface-2)',
    color: 'var(--text-primary)',
    padding: 14,
    borderRadius: 14,
    border: '1px solid var(--border-color)',
    cursor: 'pointer',
  },
  historyItem: {
    padding: '10px 0',
    borderBottom: '1px solid var(--border-color)',
  },
  historyDate: { fontWeight: 700, color: 'var(--text-strong)' },
  historyMeta: { fontSize: 12, opacity: 0.7 },
  emptyText: { opacity: 0.6 },
  circleContainer: { display: 'flex', justifyContent: 'center' },
  circle: {
    background: 'radial-gradient(circle at 30% 30%, #a78bfa, var(--accent))',
    transition: 'all 0.25s ease',
    willChange: 'transform, box-shadow',
  },
  circleContent: {
    textAlign: 'center',
    color: '#fff',
    height: '100%',
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 0,
    paddingBottom: 0,
  },
  circleCount: { fontSize: 32, fontWeight: 800 },
  circleCountLabel: { fontSize: 12 },
  sessionInstruction: { textAlign: 'center', fontSize: 22, fontWeight: 800, color: 'var(--text-strong)' },
  sessionActions: { display: 'grid', gap: 10 },
  ghostButton: { background: 'none', border: 'none', opacity: 0.6, color: 'var(--text-primary)', cursor: 'pointer' },
  helperText: {
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--text-primary)',
    opacity: 0.68,
    marginTop: -4,
  },
  safetyText: {
    fontSize: 14,
    lineHeight: 1.6,
    color: 'var(--text-primary)',
    opacity: 0.85,
    margin: 0,
  },
  switch: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    minWidth: 56,
    minHeight: 36,
    padding: 2,
    touchAction: 'manipulation',
    position: 'relative',
  },
  switchInput: {
    position: 'absolute',
    opacity: 0,
    width: '100%',
    height: '100%',
    cursor: 'pointer',
  },
  switchTrack: {
    width: 52,
    height: 32,
    background: 'var(--surface-2)',
    borderRadius: 999,
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    border: '1px solid var(--border-color)',
    transition: 'all 0.2s ease',
  },
  switchTrackActive: {
    background: 'var(--accent)',
    borderColor: 'var(--accent)',
  },
  switchThumb: {
    width: 26,
    height: 26,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    left: 3,
    top: 2,
    transition: 'all 0.2s ease',
    boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
  },
  switchThumbActive: {
    left: 23,
  },
};

const globalCss = `
  @keyframes breatheIn {
    0% { transform: scale(0.85); box-shadow: 0 0 0 rgba(124,58,237,0.2); }
    50% { box-shadow: 0 0 40px rgba(124,58,237,0.35); }
    100% { transform: scale(1.05); box-shadow: 0 0 80px rgba(124,58,237,0.5); }
  }

  @keyframes breatheOut {
    0% { transform: scale(1.05); box-shadow: 0 0 80px rgba(124,58,237,0.5); }
    50% { box-shadow: 0 0 30px rgba(124,58,237,0.3); }
    100% { transform: scale(0.85); box-shadow: 0 0 0 rgba(124,58,237,0.2); }
  }

  .theme-dark .wake-lock-dot,
  .theme-light .wake-lock-dot { display:none; }

  :root {
    --bg:#0f172a;
    --card-bg:#1e293b;
    --text-primary:#e2e8f0;
    --text-strong:#fff;
    --surface-2:#334155;
    --border-color:#475569;
    --accent:#7c3aed;
  }
  .theme-light {
    --bg:#f1f5f9;
    --card-bg:#fff;
    --text-primary:#0f172a;
    --text-strong:#000;
    --surface-2:#e2e8f0;
    --border-color:#cbd5f5;
    --accent:#7c3aed;
  }
`;
