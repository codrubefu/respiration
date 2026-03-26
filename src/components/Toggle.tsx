import './Controls.css';

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (nextValue: boolean) => void;
  hint?: string;
}

export function Toggle({ label, checked, onChange, hint }: ToggleProps) {
  return (
    <div className="toggle-row">
      <div className="toggle-row__content">
        <div className="control-group__label control-group__label--tight">{label}</div>
        {hint ? <div className="toggle-row__hint">{hint}</div> : null}
      </div>

      <label className="toggle-switch">
        <input
          checked={checked}
          className="toggle-switch__input"
          type="checkbox"
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="toggle-switch__track">
          <span className="toggle-switch__thumb" />
        </span>
      </label>
    </div>
  );
}