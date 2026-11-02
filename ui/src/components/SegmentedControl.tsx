import { useId } from "react";

interface SegmentedControlProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="segmented">
      {options.map((option) => (
        <label
          key={option.value}
          className="segment"
          data-selected={option.value === value || undefined}
          data-disabled={option.disabled || undefined}
        >
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
