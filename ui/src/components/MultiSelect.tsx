import { useCallback, useId, useRef, useState } from "react";

import { useDismiss } from "../useDismiss";
import { Button } from "./Button";
import { ChevronIcon } from "./ChevronIcon";

export interface MultiSelectOption {
  value: string;
  label: string;
  checked: boolean;
}

/** A choice that replaces the whole selection, such as "All branches". */
export interface MultiSelectPreset {
  label: string;
  active: boolean;
  onChoose: () => void;
}

interface MultiSelectProps {
  label: string;
  /** What the closed select says is selected. */
  summary: string;
  presets: MultiSelectPreset[];
  options: MultiSelectOption[];
  onToggle: (value: string, checked: boolean) => void;
}

export function MultiSelect({ label, summary, presets, options, onToggle }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const presetGroup = useId();
  const close = useCallback(() => setOpen(false), []);

  useDismiss(open, container, close);

  return (
    <div ref={container} className="multi-select">
      <Button
        variant="plain"
        className="multi-select-button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="multi-select-label">{label}</span>
        <span className="multi-select-summary">{summary}</span>
        <ChevronIcon direction="down" />
      </Button>
      {open && (
        <div role="group" aria-label={label} className="multi-select-popover">
          {presets.map((preset) => (
            <label key={preset.label} className="multi-select-option">
              <input
                type="radio"
                name={presetGroup}
                checked={preset.active}
                onChange={preset.onChoose}
              />
              {preset.label}
            </label>
          ))}
          {options.length > 0 && <hr className="multi-select-separator" />}
          <div className="multi-select-options">
            {options.map((option) => (
              <label key={option.value} className="multi-select-option">
                <input
                  type="checkbox"
                  checked={option.checked}
                  onChange={(event) => onToggle(option.value, event.target.checked)}
                />
                <span className="multi-select-option-label" title={option.label}>
                  {option.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
