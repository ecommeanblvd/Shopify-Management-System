'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, X, Loader2 } from 'lucide-react';

export interface MatrixZone {
  id: string;
  label: string;
}

export interface MatrixTier {
  id: string;
  upperKg: string;
}

export interface MatrixInitialCell {
  zoneId: string;
  tierId: string;
  costAmount: string;
}

interface Props {
  zones: MatrixZone[];
  tiers: MatrixTier[];
  initialCells: MatrixInitialCell[];
  costCurrency: string;
  canEdit: boolean;
  setCellAction: (input: { zoneId: string; tierId: string; costAmount: string }) => Promise<void>;
  clearCellAction: (input: { zoneId: string; tierId: string }) => Promise<void>;
}

type CellState = 'idle' | 'saving' | 'saved' | 'error';

// VND has no fractional unit. We strip decimals on display and group thousands.
const VND_FORMATTER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function formatVnd(raw: string): string {
  if (!raw) return '';
  const n = Number(String(raw).replace(/[,_\s]/g, ''));
  if (!Number.isFinite(n)) return raw;
  return VND_FORMATTER.format(Math.round(n));
}

function parseVnd(input: string): number | null {
  if (!input.trim()) return null;
  const n = Number(input.replace(/[,_\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function RateMatrix({ zones, tiers, initialCells, costCurrency, canEdit, setCellAction, clearCellAction }: Props) {
  // Map raw DB values to formatted display values ("401928.00" → "401,928")
  const initialMap = new Map<string, string>(
    initialCells.map((c) => [`${c.zoneId}|${c.tierId}`, formatVnd(c.costAmount)]),
  );
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(initialMap.entries()));
  const [state, setState] = useState<Record<string, CellState>>({});

  function setCellState(key: string, s: CellState) {
    setState((prev) => ({ ...prev, [key]: s }));
  }

  if (zones.length === 0 || tiers.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-12 text-center">
        {zones.length === 0 && tiers.length === 0
          ? 'Define at least one zone and one weight tier before filling the matrix.'
          : zones.length === 0
            ? 'Define at least one zone to fill the matrix.'
            : 'Define at least one weight tier to fill the matrix.'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: `${180 + zones.length * 140}px` }}>
        <colgroup>
          <col style={{ width: '180px' }} />
          {zones.map((z) => <col key={z.id} style={{ minWidth: '140px' }} />)}
        </colgroup>
        <thead className="sticky top-0 z-20">
          <tr>
            <th
              className="sticky left-0 z-30 text-left px-5 py-4 border-b-2 border-r-2 border-border text-xs uppercase tracking-wide text-muted-foreground font-bold whitespace-nowrap"
              style={{ backgroundColor: 'var(--muted)' }}
            >
              kg ↑ &nbsp;/&nbsp; zone →
            </th>
            {zones.map((z) => (
              <th
                key={z.id}
                className="text-right px-5 py-4 border-b-2 border-border text-sm uppercase tracking-wide text-foreground font-bold whitespace-nowrap"
                style={{ backgroundColor: 'var(--muted)' }}
              >
                {z.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tiers.map((t, i) => {
            const prev = i === 0 ? 0 : Number(tiers[i - 1].upperKg);
            const upper = Number(t.upperKg);
            const zebra = i % 2 === 1;
            const dataBg = zebra ? 'bg-muted/15' : '';
            return (
              <tr key={t.id} className={dataBg}>
                <th
                  className="sticky left-0 z-20 text-left px-5 py-3 border-b border-r-2 border-border whitespace-nowrap font-mono text-sm tabular-nums text-foreground font-semibold"
                  style={{ backgroundColor: 'var(--muted)' }}
                >
                  ({fmtKg(prev)}–{fmtKg(upper)}] kg
                </th>
                {zones.map((z) => {
                  const key = `${z.id}|${t.id}`;
                  return (
                    <Cell
                      key={key}
                      cellKey={key}
                      value={values[key] ?? ''}
                      state={state[key] ?? 'idle'}
                      currency={costCurrency}
                      canEdit={canEdit}
                      onChange={(v) => setValues((p) => ({ ...p, [key]: v }))}
                      onCommit={async (v) => {
                        const trimmed = v.trim();
                        const isEmpty = trimmed === '';
                        const hadValue = (initialMap.get(key) ?? '') !== '';

                        if (isEmpty && hadValue) {
                          setCellState(key, 'saving');
                          try {
                            await clearCellAction({ zoneId: z.id, tierId: t.id });
                            initialMap.delete(key);
                            setCellState(key, 'saved');
                            setTimeout(() => setCellState(key, 'idle'), 1500);
                          } catch {
                            setCellState(key, 'error');
                          }
                          return;
                        }

                        if (isEmpty) return; // no-op

                        const parsed = parseVnd(trimmed);
                        if (parsed === null) {
                          setCellState(key, 'error');
                          return;
                        }

                        const formatted = formatVnd(String(parsed));
                        if (formatted === (initialMap.get(key) ?? '')) {
                          // no change after rounding
                          setValues((p) => ({ ...p, [key]: formatted }));
                          return;
                        }

                        setCellState(key, 'saving');
                        try {
                          await setCellAction({ zoneId: z.id, tierId: t.id, costAmount: String(parsed) });
                          initialMap.set(key, formatted);
                          setValues((p) => ({ ...p, [key]: formatted }));
                          setCellState(key, 'saved');
                          setTimeout(() => setCellState(key, 'idle'), 1500);
                        } catch {
                          setCellState(key, 'error');
                        }
                      }}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtKg(kg: number): string {
  // 0.5 → "0.5", 30 → "30", 0 → "0"
  return Number.isInteger(kg) ? kg.toString() : kg.toString();
}

interface CellProps {
  cellKey: string;
  value: string;
  state: CellState;
  currency: string;
  canEdit: boolean;
  onChange: (v: string) => void;
  onCommit: (v: string) => Promise<void>;
}

function Cell({ value, state, currency, canEdit, onChange, onCommit }: CellProps) {
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Clear error styling once user begins typing again
  useEffect(() => {
    if (focused && state === 'error') {
      // visual reset only — actual error fires on next commit
    }
  }, [focused, state]);

  if (!canEdit) {
    return (
      <td className="px-5 py-3 border-b border-border tabular-nums text-right whitespace-nowrap text-foreground">
        {value ? value : <span className="text-muted-foreground/40">—</span>}
        {value && <span className="text-muted-foreground/60 text-[10px] ml-1">{currency}</span>}
      </td>
    );
  }

  const stateRing =
    state === 'saving' ? 'ring-1 ring-muted-foreground/30'
    : state === 'saved' ? 'ring-1 ring-emerald-500/50'
    : state === 'error' ? 'ring-1 ring-destructive'
    : '';

  return (
    <td className="border-b border-border p-0">
      <div className="relative">
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false);
            startTransition(() => { onCommit(e.target.value); });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setFocused(false);
              ref.current?.blur();
            }
          }}
          onChange={(e) => onChange(e.target.value)}
          placeholder="—"
          className={
            'w-full bg-transparent text-right tabular-nums px-5 py-3 outline-none transition-colors ' +
            'focus:bg-primary/[0.08] focus:text-foreground placeholder:text-muted-foreground/40 ' +
            stateRing
          }
        />
        {state === 'saving' && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden>
            <Loader2 className="size-3 animate-spin" />
          </span>
        )}
        {state === 'saved' && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-emerald-500" aria-hidden>
            <Check className="size-3" />
          </span>
        )}
        {state === 'error' && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-destructive" aria-hidden>
            <X className="size-3" />
          </span>
        )}
      </div>
    </td>
  );
}
