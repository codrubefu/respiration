import { useEffect, useMemo, useRef, useState } from 'react';
import '../App.css';
import {
  BREATHING_SPEEDS,
  DEFAULT_SETTINGS,
  PHASES,
  SAFETY_MESSAGE,
  STORAGE_KEYS,
} from '../constants';
import { AboutScreen } from '../components/AboutScreen';
import { AppHeader } from '../components/AppHeader';
import { DashboardScreen } from '../components/DashboardScreen';
import { HistoryScreen } from '../components/HistoryScreen';
import { HomeScreen } from '../components/HomeScreen';
import { SessionScreen } from '../components/SessionScreen';
import { SummaryScreen } from '../components/SummaryScreen';
import type {
  BreathingPace,
  FeedbackType,
  NumericSettingKey,
  Phase,
  Screen,
  SessionRecord,
  Settings,
  ToggleSettingKey,
} from '../types';
import {
  getPhaseInstruction,
  getPhaseTitle,
  readStorage,
  safePlayTone,
  safeVibrate,
  writeStorage,
} from '../utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type ExtendedNavigator = Navigator & {
  standalone?: boolean;
};

export default function AppRoot() {
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
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showIosInstallHint, setShowIosInstallHint] = useState(false);

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
    setSafetyAccepted(savedSafety);
  }, []);

  useEffect(() => {
    const standaloneMatch = window.matchMedia('(display-mode: standalone)').matches;
    const navigatorWithStandalone = navigator as ExtendedNavigator;
    const isIosDevice = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    const installed = standaloneMatch || navigatorWithStandalone.standalone === true;

    setIsInstalled(installed);
    setShowIosInstallHint(isIosDevice && !installed);

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
      setShowIosInstallHint(false);
      setNotice('Aplicatia a fost instalata pe dispozitiv.');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
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

  async function handleInstallApp() {
    if (isInstalled) {
      return;
    }

    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);

      if (choice.outcome === 'accepted') {
        setNotice('Instalarea a fost confirmata. Aplicatia va aparea pe telefon dupa finalizare.');
      }
      return;
    }

    if (showIosInstallHint) {
      setNotice('Pe iPhone, deschide Safari, apoi Share si Add to Home Screen pentru instalare.');
    }
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
        {screen !== 'session' ? (
          <AppHeader
            canInstall={installPrompt !== null}
            currentScreen={screen}
            isInstalled={isInstalled}
            onInstall={() => {
              void handleInstallApp();
            }}
            theme={settings.theme}
            showIosHint={showIosInstallHint}
            onNavigate={setScreen}
            onThemeChange={handleThemeToggle}
          />
        ) : null}

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
  const activePhases: Phase[] = [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY];
  return activePhases.includes(phase);
}

function isSessionVisiblePhase(phase: Phase) {
  const visiblePhases: Phase[] = [PHASES.BREATHING, PHASES.HOLD, PHASES.RECOVERY, PHASES.PAUSED];
  return visiblePhases.includes(phase);
}