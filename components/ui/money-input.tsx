'use client';

import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Strip thousand separators (comma, ASCII / narrow / regular no-break
 * spaces), reject anything that isn't a digit or the decimal point, and
 * clamp to the configured decimal places.
 *
 * Exported so the same parser used in the UI can be reused in tests.
 */
export function sanitizeMoneyRaw(input: string, decimals: number): string {
  // Strip separators first so a pasted "1,234,567" works.
  const stripped = input.replace(/[,\s  ]/g, '');
  // Keep only digits and one dot.
  const digitsAndDot = stripped.replace(/[^0-9.]/g, '');
  // Collapse multiple dots — keep only the first.
  const firstDot = digitsAndDot.indexOf('.');
  let normalised;
  if (firstDot === -1) {
    normalised = digitsAndDot;
  } else {
    normalised =
      digitsAndDot.slice(0, firstDot + 1) +
      digitsAndDot.slice(firstDot + 1).replace(/\./g, '');
  }
  // Clamp decimal places (decimals=0 → no fraction at all).
  if (decimals <= 0) {
    return normalised.replace(/\..*$/, '');
  }
  if (normalised.includes('.')) {
    const [intPart, fracPart] = normalised.split('.');
    return `${intPart}.${fracPart.slice(0, decimals)}`;
  }
  return normalised;
}

/**
 * Format the canonical raw value for display: thousand separators on the
 * integer part, decimal part left untouched so the user can keep typing.
 *
 * "1234.50" → "1,234.50"
 * "1234."   → "1,234."   (mid-typing, trailing dot preserved)
 * ""        → ""
 */
export function formatMoneyForDisplay(raw: string): string {
  if (!raw) return '';
  const [intPart, fracPart] = raw.split('.');
  // Number('') is 0; guard so an in-progress ".5" shows as ".5".
  const intFormatted = intPart === '' ? '' : Number(intPart).toLocaleString('en-US');
  if (raw.endsWith('.') && fracPart === undefined) {
    return `${intFormatted}.`;
  }
  if (fracPart !== undefined) {
    return `${intFormatted}.${fracPart}`;
  }
  return intFormatted;
}

interface MoneyInputProps {
  /** Canonical raw value (no separators). Empty string means "unset". */
  value: string;
  /** Called with the sanitised raw value on every change. */
  onValueChange: (raw: string) => void;
  /** Max decimal places. VND=0, USD=2. Default 2. */
  decimals?: number;
  /** Suffix label inside the input chrome (e.g. "VND"). */
  suffix?: string;
  placeholder?: string;
  className?: string;
  /** Extra classes on the <input> element itself (height, alignment). */
  inputClassName?: string;
  disabled?: boolean;
  id?: string;
  /** Form field name. When set, a hidden input ships the SEPARATOR-LESS
   *  canonical value so server actions / FormData receive a clean number
   *  string regardless of how it was displayed. */
  name?: string;
  required?: boolean;
  'aria-label'?: string;
}

/**
 * Text input that displays monetary values with locale-aware thousand
 * separators while the canonical value exchanged with the parent stays a
 * clean separator-less string (e.g. "1234567"). Operators can't easily
 * mistype "1171000" as "117100" anymore — the live "1,171,000" view makes
 * the magnitude obvious.
 *
 * Why text + inputMode="decimal" instead of `<input type="number">`:
 *   - number inputs can't show formatted strings; the browser strips
 *     non-digits and renders raw.
 *   - inputMode="decimal" still pops the numeric keypad on mobile.
 */
export function MoneyInput({
  value,
  onValueChange,
  decimals = 2,
  suffix,
  placeholder,
  className,
  inputClassName,
  disabled,
  id,
  name,
  required,
  'aria-label': ariaLabel,
}: MoneyInputProps) {
  const reactId = useId();
  const inputId = id ?? reactId;

  const display = formatMoneyForDisplay(value);

  return (
    <div className={cn('relative flex items-center', className)}>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        id={inputId}
        // NOTE: deliberately no `name` here — the visible input shows
        // "1,234,567" which a server action would receive verbatim. The
        // hidden input below carries the clean canonical value for forms.
        aria-label={ariaLabel}
        placeholder={placeholder}
        disabled={disabled}
        value={display}
        onChange={(e) => onValueChange(sanitizeMoneyRaw(e.target.value, decimals))}
        onPaste={(e) => {
          e.preventDefault();
          const pasted = e.clipboardData.getData('text');
          onValueChange(sanitizeMoneyRaw(pasted, decimals));
        }}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-input/30 px-3 text-sm font-mono tabular-nums outline-none transition-colors',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          suffix && 'pr-12',
          inputClassName,
        )}
      />
      {name && (
        <input
          type="hidden"
          name={name}
          value={value}
          required={required}
        />
      )}
      {suffix && (
        <span className="pointer-events-none absolute right-3 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  );
}

/**
 * Server-form variant: an uncontrolled `<MoneyInput>` for use inside
 * `<form action={serverAction}>`. Manages its own state from `defaultValue`,
 * ships the canonical raw via a hidden field — no parent state needed.
 */
interface MoneyInputFieldProps extends Omit<MoneyInputProps, 'value' | 'onValueChange'> {
  defaultValue?: string;
}

export function MoneyInputField({ defaultValue, ...rest }: MoneyInputFieldProps) {
  const [value, setValue] = useState(defaultValue ?? '');
  return <MoneyInput {...rest} value={value} onValueChange={setValue} />;
}
