import './Controls.css';

interface StepperProps {
  label: string;
  value: number;
  onMinus: () => void;
  onPlus: () => void;
  min?: number;
  max?: number;
  suffix?: string;
}

export function Stepper({
  label,
  value,
  onMinus,
  onPlus,
  min = 1,
  max = 99,
  suffix = '',
}: StepperProps) {
  return (
    <div className="control-group">
      <div className="control-group__label">{label}</div>
      <div className="stepper">
        <button className="stepper__button" type="button" onClick={onMinus} disabled={value <= min}>
          −
        </button>
        <div className="stepper__value">{value}{suffix}</div>
        <button className="stepper__button" type="button" onClick={onPlus} disabled={value >= max}>
          +
        </button>
      </div>
    </div>
  );
}