'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Check, X, Loader2, Search } from 'lucide-react';
import { sanitizeMoneyRaw, formatMoneyForDisplay } from '@/components/ui/money-input';

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

// VND has no fractional unit. We use the shared MoneyInput helpers so the
// matrix shows live thousand separators while typing, not just on blur.
// `sanitizeMoneyRaw(input, 0)` strips decimals + separators; the display
// re-injects commas via `formatMoneyForDisplay`.

function parseVnd(input: string): number | null {
  const raw = sanitizeMoneyRaw(input, 0);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function RateMatrix({ zones, tiers, initialCells, costCurrency, canEdit, setCellAction, clearCellAction }: Props) {
  // Map raw DB values to CANONICAL raw values (no separators). The Cell
  // component renders them through `formatMoneyForDisplay` so commas appear
  // live as the operator types.
  const initialMap = new Map<string, string>(
    initialCells.map((c) => [`${c.zoneId}|${c.tierId}`, sanitizeMoneyRaw(c.costAmount, 0)]),
  );
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(initialMap.entries()));
  const [state, setState] = useState<Record<string, CellState>>({});

  // Money-amount search — lifted here so the table can highlight the
  // matching cells while <MatrixSearch> renders the result chip list.
  const [searchRaw, setSearchRaw] = useState('');
  const [tolPct, setTolPct] = useState(2);
  const searchTarget = useMemo(() => parseVnd(searchRaw), [searchRaw]);
  const matchedKeys = useMemo(() => {
    if (searchTarget === null) return new Set<string>();
    const out = new Set<string>();
    for (const [key, str] of Object.entries(values)) {
      if (!str) continue;
      const amount = Number(str);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const gapPct = Math.abs(amount - searchTarget) / Math.max(amount, 1) * 100;
      if (gapPct <= tolPct) out.add(key);
    }
    return out;
  }, [searchTarget, tolPct, values]);

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
    <div className="space-y-3">
      <MatrixSearch
        values={values}
        zones={zones}
        tiers={tiers}
        costCurrency={costCurrency}
        searchRaw={searchRaw}
        onSearchChange={setSearchRaw}
        tolPct={tolPct}
        onTolPctChange={setTolPct}
        target={searchTarget}
      />
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
                      highlighted={matchedKeys.has(key)}
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

                        // Both `values[key]` and `initialMap` store the
                        // CANONICAL raw (no separators). Display formatting
                        // happens in <Cell> via `formatMoneyForDisplay`.
                        const canonical = String(parsed);
                        if (canonical === (initialMap.get(key) ?? '')) {
                          // no change after rounding
                          setValues((p) => ({ ...p, [key]: canonical }));
                          return;
                        }

                        setCellState(key, 'saving');
                        try {
                          await setCellAction({ zoneId: z.id, tierId: t.id, costAmount: canonical });
                          initialMap.set(key, canonical);
                          setValues((p) => ({ ...p, [key]: canonical }));
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
    </div>
  );
}

/**
 * Find which (zone, tier) cell(s) match a given VND amount within a
 * configurable percent tolerance. Helps the operator reconcile a
 * carrier invoice amount back to its source row in the rate sheet —
 * e.g. "we got billed 838,334 VND — which weight bracket and zone
 * was that?".
 *
 * Pure client-side filter against the current cell values. Read-only;
 * does not write to the matrix.
 */
interface MatrixSearchProps {
  values: Record<string, string>;
  zones: MatrixZone[];
  tiers: MatrixTier[];
  costCurrency: string;
  searchRaw: string;
  onSearchChange: (s: string) => void;
  tolPct: number;
  onTolPctChange: (n: number) => void;
  target: number | null;
}

function MatrixSearch({
  values, zones, tiers, costCurrency,
  searchRaw: raw, onSearchChange: setRaw,
  tolPct, onTolPctChange: setTolPct,
  target,
}: MatrixSearchProps): React.ReactNode {
  const matches = useMemo(() => {
    if (target === null) return [];
    const zonesById = new Map(zones.map((z) => [z.id, z]));
    const tiersById = new Map(tiers.map((t) => [t.id, t]));
    const out: Array<{ zoneLabel: string; tierUpper: number; tierLower: number; amount: number; gapPct: number }> = [];
    for (const [key, str] of Object.entries(values)) {
      if (!str) continue;
      const amount = Number(str);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const gapPct = Math.abs(amount - target) / Math.max(amount, 1) * 100;
      if (gapPct > tolPct) continue;
      const [zoneId, tierId] = key.split('|');
      const z = zonesById.get(zoneId);
      const t = tiersById.get(tierId);
      if (!z || !t) continue;
      // Compute tier lower bound — the matrix doesn't display it but
      // operators read in "weight is BETWEEN X and Y kg" form, so we
      // do the lookup once.
      const sortedTiers = [...tiers].sort((a, b) => Number(a.upperKg) - Number(b.upperKg));
      const idx = sortedTiers.findIndex((x) => x.id === tierId);
      const lower = idx <= 0 ? 0 : Number(sortedTiers[idx - 1].upperKg);
      out.push({
        zoneLabel: z.label,
        tierUpper: Number(t.upperKg),
        tierLower: lower,
        amount,
        gapPct,
      });
    }
    return out.sort((a, b) => a.gapPct - b.gapPct);
  }, [target, tolPct, values, zones, tiers]);

  return (
    <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            inputMode="numeric"
            value={raw && target !== null ? formatMoneyForDisplay(String(target)) : raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={`Tìm theo số tiền ${costCurrency} → match cân nặng nào`}
            className="text-sm h-9 pl-9 pr-3 rounded border border-border bg-background w-full focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>
        <label className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
          ± tolerance
          <input
            type="number"
            min={0}
            max={50}
            step={0.5}
            value={tolPct}
            onChange={(e) => setTolPct(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
            className="text-sm h-9 w-16 px-2 rounded border border-border bg-background tabular-nums"
          />
          %
        </label>
        {raw && (
          <button
            type="button"
            onClick={() => setRaw('')}
            className="text-xs px-2 h-9 rounded border border-border hover:bg-background"
          >
            Clear
          </button>
        )}
      </div>

      {target !== null && (
        matches.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Không có cell nào khớp{' '}
            <span className="font-mono font-medium">{formatMoneyForDisplay(String(target))}</span>
            {' '}{costCurrency} (±{tolPct}%).
            Tăng tolerance hoặc kiểm tra surcharge / discount đang làm số khác.
          </p>
        ) : (
          <div className="text-xs space-y-1">
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">{matches.length}</span>{' '}
              {matches.length === 1 ? 'match' : 'matches'} cho{' '}
              <span className="font-mono font-medium">{formatMoneyForDisplay(String(target))}</span>{' '}
              {costCurrency} (±{tolPct}%)
            </p>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 font-mono">
              {matches.slice(0, 30).map((m, i) => (
                <li key={i} className="bg-amber-500/20 dark:bg-amber-500/15 border border-amber-500/40 rounded px-2 py-1">
                  <span className="font-semibold">{m.zoneLabel}</span>
                  {' '}@ {fmtKg(m.tierLower)}–{fmtKg(m.tierUpper)} kg
                  {' = '}
                  <span className="font-semibold">{formatMoneyForDisplay(String(Math.round(m.amount)))}</span>
                  {m.gapPct > 0.05 && (
                    <span className="text-muted-foreground"> (Δ {m.gapPct.toFixed(1)}%)</span>
                  )}
                </li>
              ))}
            </ul>
            {matches.length > 30 && (
              <p className="text-muted-foreground italic">… và {matches.length - 30} matches khác. Giảm tolerance để filter.</p>
            )}
          </div>
        )
      )}
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
  /** When true, the cell's value is within tolerance of the operator's
   *  search amount — surface it with a coloured background so the eye
   *  catches it even on a wide matrix. */
  highlighted: boolean;
  onChange: (v: string) => void;
  onCommit: (v: string) => Promise<void>;
}

function Cell({ value, state, currency, canEdit, highlighted, onChange, onCommit }: CellProps) {
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);

  // Clear error styling once user begins typing again
  useEffect(() => {
    if (focused && state === 'error') {
      // visual reset only — actual error fires on next commit
    }
  }, [focused, state]);

  // `value` is the canonical raw (e.g. "401928"). Always render through the
  // formatter so the read-only and editable cells both show "401,928".
  const display = formatMoneyForDisplay(value);

  const highlightBg = highlighted ? 'bg-amber-500/30 dark:bg-amber-500/25' : '';

  if (!canEdit) {
    return (
      <td className={`px-5 py-3 border-b border-border tabular-nums text-right whitespace-nowrap text-foreground ${highlightBg}`}>
        {display ? display : <span className="text-muted-foreground/40">—</span>}
        {display && <span className="text-muted-foreground/60 text-[10px] ml-1">{currency}</span>}
      </td>
    );
  }

  const stateRing =
    state === 'saving' ? 'ring-1 ring-muted-foreground/30'
    : state === 'saved' ? 'ring-1 ring-emerald-500/50'
    : state === 'error' ? 'ring-1 ring-destructive'
    : '';

  return (
    <td className={`border-b border-border p-0 ${highlightBg}`}>
      <div className="relative">
        <input
          ref={ref}
          type="text"
          inputMode="numeric"
          value={display}
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
          onChange={(e) => onChange(sanitizeMoneyRaw(e.target.value, 0))}
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
