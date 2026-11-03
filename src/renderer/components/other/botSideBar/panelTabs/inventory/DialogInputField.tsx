import React from 'react';
import type {
  DialogInput,
  DialogValue,
} from '../../../../../../main/src/workers/workerTypes';
import { McAnsiText } from './Mc';

interface DialogInputFieldProps {
  input: DialogInput;
  value: DialogValue;
  onChange: (value: DialogValue) => void;
}

const formatNumber = (value: number) => String(Math.round(value * 100) / 100);

/** One dialog input, drawn like its vanilla widget. */
const DialogInputField: React.FC<DialogInputFieldProps> = ({
  input,
  value,
  onChange,
}) => {
  const label = input.showLabel ? input.label : '';

  switch (input.type) {
    case 'text': {
      const Field = input.multiline ? 'textarea' : 'input';
      return (
        <label className="mc-dialog-field">
          {label && <McAnsiText text={label} fontSize={14} />}
          <Field
            className="mc-field"
            value={String(value)}
            maxLength={input.maxLength}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      );
    }
    case 'boolean':
      return (
        <button
          type="button"
          role="checkbox"
          aria-checked={Boolean(value)}
          className="mc-checkbox"
          onClick={() => onChange(!value)}
        >
          <span className="mc-checkbox-box">{value ? '✔' : ''}</span>
          <McAnsiText text={input.label} fontSize={14} />
        </button>
      );
    case 'single_option': {
      const index = input.options.findIndex((o) => o.id === value);
      const option = input.options[index];
      // Vanilla cycles forward on click, backwards with shift
      const cycle = (step: number) => {
        const count = input.options.length;
        onChange(input.options[(index + step + count) % count].id);
      };
      return (
        <button
          type="button"
          className="mc-button"
          onClick={(e) => cycle(e.shiftKey ? -1 : 1)}
        >
          <McAnsiText
            text={
              label
                ? `${label}: ${option?.display ?? ''}`
                : option?.display ?? ''
            }
          />
        </button>
      );
    }
    case 'number_range':
      return (
        <div className="mc-slider">
          <input
            type="range"
            min={input.start}
            max={input.end}
            step={input.step ?? 'any'}
            value={Number(value)}
            aria-label={input.label}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <span>
            <McAnsiText
              text={`${label ? `${label}: ` : ''}${formatNumber(Number(value))}`}
            />
          </span>
        </div>
      );
  }
};

export default DialogInputField;
