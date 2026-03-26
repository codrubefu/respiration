import { Stepper } from './Stepper';
import { Toggle } from './Toggle';
import type { BreathingPace, NumericSettingKey, Settings, ToggleSettingKey } from '../types';
import './Controls.css';
import './Screens.css';

interface HomeScreenProps {
  settings: Settings;
  safetyAccepted: boolean;
  notice: string;
  safetyMessage: string;
  onNumericSettingChange: (key: NumericSettingKey, delta: number, min: number, max: number) => void;
  onBreathingPaceChange: (pace: BreathingPace) => void;
  onToggleSetting: (key: ToggleSettingKey, value: boolean) => void;
  onSoundToggle: (value: boolean) => void | Promise<void>;
  onSafetyAcceptedChange: (value: boolean) => void;
  onStartSession: () => void;
}

const paceLabels: Record<BreathingPace, string> = {
  slow: 'Lent',
  medium: 'Mediu',
  fast: 'Rapid',
};

export function HomeScreen({
  settings,
  safetyAccepted,
  notice,
  safetyMessage,
  onNumericSettingChange,
  onBreathingPaceChange,
  onToggleSetting,
  onSoundToggle,
  onSafetyAcceptedChange,
  onStartSession,
}: HomeScreenProps) {
  return (
    <section className="screen">
      <div className="screen-copy">
        <h1 className="screen-title">Configurare sesiune</h1>
        <p className="screen-subtitle">Ajustează parametrii sesiunii înainte să pornești exercițiul.</p>
        {notice ? <p className="screen-notice">{notice}</p> : null}
      </div>

      <article className="surface-card">
        <div className="surface-card__title">Setări sesiune</div>

        <Stepper
          label="Runde"
          max={10}
          min={1}
          value={settings.rounds}
          onMinus={() => onNumericSettingChange('rounds', -1, 1, 10)}
          onPlus={() => onNumericSettingChange('rounds', 1, 1, 10)}
        />

        <Stepper
          label="Respirații / rundă"
          max={60}
          min={10}
          value={settings.breathsPerRound}
          onMinus={() => onNumericSettingChange('breathsPerRound', -5, 10, 60)}
          onPlus={() => onNumericSettingChange('breathsPerRound', 5, 10, 60)}
        />

        <Stepper
          label="Recuperare"
          max={30}
          min={5}
          suffix="s"
          value={settings.recoverySeconds}
          onMinus={() => onNumericSettingChange('recoverySeconds', -5, 5, 30)}
          onPlus={() => onNumericSettingChange('recoverySeconds', 5, 5, 30)}
        />

        <div className="control-group">
          <div className="control-group__label">Ritm respirație</div>
          <div className="segmented-control">
            {(Object.keys(paceLabels) as BreathingPace[]).map((pace) => (
              <button
                key={pace}
                className={`segmented-control__button${settings.breathingPace === pace ? ' is-active' : ''}`}
                type="button"
                onClick={() => onBreathingPaceChange(pace)}
              >
                {paceLabels[pace]}
              </button>
            ))}
          </div>
        </div>

        <Toggle
          checked={settings.vibrationEnabled}
          label="Vibrații"
          onChange={(value) => onToggleSetting('vibrationEnabled', value)}
        />
        <Toggle checked={settings.soundEnabled} label="Sunet" onChange={onSoundToggle} />
        <Toggle
          checked={settings.showHoldTimer}
          hint="Ascunde sau afișează timpul de retenție în timpul sesiunii."
          label="Timer retenție vizibil"
          onChange={(value) => onToggleSetting('showHoldTimer', value)}
        />

        <p className="helper-text">
          Sunetul în browser pornește doar după o interacțiune explicită și poate fi foarte discret pe unele dispozitive.
        </p>
      </article>

      <article className="surface-card">
        <div className="surface-card__title">Siguranță</div>
        <p className="safety-copy">{safetyMessage}</p>
        <Toggle
          checked={safetyAccepted}
          label="Confirm că am citit și înțeles regulile de siguranță"
          onChange={onSafetyAcceptedChange}
        />
      </article>

      <button className="button button--primary button--full" type="button" onClick={onStartSession}>
        Start sesiune
      </button>
    </section>
  );
}