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

export function RateMatrix({ zones, tiers, initialCells, costCurrency, canEdit, setCellAction, clearCellAction }: Props) {
  // Pre-build a map of values keyed by `${zoneId}|${tierId}` → cost string
  const initialMap = new Map<string, string>(initialCells.map((c) => [`${c.zoneId}|${c.tierId}`, c.costAmount]));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(initialMap.entries()));
  const [state, setState] = useState<Record<string, CellState>>({});

  function setCellState(key: string, s: CellState) {
    setState((prev) => ({ ...prev, [key]: s }));
  }

  if (zones.length === 0 || tiers.length === 0) {
    return (
      <div className="text-sm text-muted-foreground italic py-6 text-center">
        {zones.length === 0 && tiers.length === 0
          ? 'Define at least one zone and one weight tier before filling the matrix.'
          : zones.length === 0
            ? 'Define at least one zone to fill the matrix.'
            : 'Define at least one weight tier to fill the matrix.'}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-card text-left px-3 py-2.5 border-b border-r border-border text-xs uppercase tracking-wider text-muted-foreground">
              kg ↑ / zone →
            </th>
            {zones.map((z) => (
              <th key={z.id} className="text-left px-3 py-2.5 border-b border-border text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap font-medium">
                {z.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tiers.map((t, i) => {
            const prev = i === 0 ? 0 : Number(tiers[i - 1].upperKg);
            const upper = Number(t.upperKg);
            return (
              <tr key={t.id}>
                <th className="sticky left-0 z-10 bg-card text-left px-3 py-2 border-b border-r border-border font-mono text-xs tabular-nums whitespace-nowrap">
                  ({prev}–{upper}] kg
                </th>
                {zones.map((z) => {
                  const key = `${z.id}|${t.id}`;
                  return (
                    <Cell
                      key={key}
                      cellKey={key}
                      zoneId={z.id}
                      tierId={t.id}
                      value={values[key] ?? ''}
                      state={state[key] ?? 'idle'}
                      currency={costCurrency}
                      canEdit={canEdit}
                      onChange={(v) => setValues((p) => ({ ...p, [key]: v }))}
                      onCommit={async (v) => {
                        const trimmed = v.trim();
                        if (trimmed === '' || trimmed === (initialMap.get(key) ?? '')) {
                          if (trimmed === '' && (initialMap.get(key) ?? '') !== '') {
                            setCellState(key, 'saving');
                            try {
                              await clearCellAction({ zoneId: z.id, tierId: t.id });
                              initialMap.delete(key);
                              setCellState(key, 'saved');
                              setTimeout(() => setCellState(key, 'idle'), 1500);
                            } catch {
                              setCellState(key, 'error');
                            }
                          }
                          return;
                        }
                        const n = Number(trimmed.replace(/[,_\s]/g, ''));
                        if (!Number.isFinite(n) || n < 0) {
                          setCellState(key, 'error');
                          return;
                        }
                        setCellState(key, 'saving');
                        try {
                          await setCellAction({ zoneId: z.id, tierId: t.id, costAmount: n.toString() });
                          initialMap.set(key, n.toFixed(2));
                          setValues((p) => ({ ...p, [key]: n.toFixed(2) }));
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

interface CellProps {
  cellKey: string;
  zoneId: string;
  tierId: string;
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

  // Auto-revert error state when user starts typing again
  useEffect(() => {
    if (state === 'error' && focused) {
      // intentional no-op; cleared by next onCommit
    }
  }, [state, focused]);

  if (!canEdit) {
    return (
      <td className="px-3 py-2 border-b border-border font-mono tabular-nums text-right whitespace-nowrap">
        {value ? formatCost(value, currency) : <span className="text-muted-foreground/40">—</span>}
      </td>
    );
  }

  const stateStyle = state === 'saving' ? 'ring-1 ring-muted-foreground/30'
    : state === 'saved' ? 'ring-1 ring-emerald-500/50'
    : state === 'error' ? 'ring-1 ring-destructive'
    : '';

  return (
    <td className="border-b border-border p-0">
      <div className="relative">
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
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
            'w-full bg-transparent text-right font-mono tabular-nums px-3 py-2 outline-none focus:bg-muted/40 ' +
            stateStyle
          }
        />
        {state === 'saving' && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"><Loader2 className="size-3 animate-spin" /></span>
        )}
        {state === 'saved' && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-emerald-500"><Check className="size-3" /></span>
        )}
        {state === 'error' && (
          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-destructive"><X className="size-3" /></span>
        )}
      </div>
    </td>
  );
}

function formatCost(s: string, currency: string): string {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${n.toLocaleString()} ${currency}`;
  }
}
