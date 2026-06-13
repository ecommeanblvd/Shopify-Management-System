'use client';

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Check, X, Loader2, Search } from 'lucide-react';
import { sanitizeMoneyRaw, formatMoneyForDisplay } from '@/components/ui/money-input';

export interface MatrixZone {
  id: string;
  label: string;
}

export interface MatrixTier {
  id: string;
  upperKg: string;
  /** Cận dưới (kg) của bậc — dùng khi list gộp nhiều nhóm (PAK + Package) nên
   *  không thể suy từ dòng trước. Bỏ trống → suy từ upperKg dòng liền trước. */
  prevKg?: number;
  /** Nếu set, render một dòng tiêu đề nhóm (vd "PAK", "Package · hộp") NGAY TRƯỚC
   *  bậc này — để gộp nhiều nhóm trong cùng 1 bảng, chung header zone + search. */
  groupLabel?: string;
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
  setCellAction?: (input: { zoneId: string; tierId: string; costAmount: string }) => Promise<void>;
  clearCellAction?: (input: { zoneId: string; tierId: string }) => Promise<void>;
  /** When set, the matching zone's column (header + cells) gets a highlight ring. */
  highlightZoneId?: string | null;
  /** Optional node rendered on the left of the search toolbar row — e.g. the
   *  rate-card dropdown — so the matrix has a single `[card] … [search]` row. */
  toolbarStart?: React.ReactNode;
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

export function RateMatrix({ zones, tiers, initialCells, costCurrency, canEdit, setCellAction, clearCellAction, highlightZoneId = null, toolbarStart }: Props) {
  // Map raw DB values to CANONICAL raw values (no separators). The Cell
  // component renders them through `formatMoneyForDisplay` so commas appear
  // live as the operator types.
  const initialMap = new Map<string, string>(
    initialCells.map((c) => [`${c.zoneId}|${c.tierId}`, sanitizeMoneyRaw(c.costAmount, 0)]),
  );
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(initialMap.entries()));
  const [state, setState] = useState<Record<string, CellState>>({});

  // Money-amount search — lifted here so the table can colour the
  // matching cells while <MatrixSearch> renders the chip summary.
  //
  // Two highlight tiers:
  //   green  — exact match (amount === target after VND rounding)
  //   blue   — near match  (|gap| ≤ NEAR_MATCH_PCT, but not exact)
  //
  // The operator reverse-looks-up an invoice amount → exact-match
  // (green) means the rate sheet still has that price; near-match
  // (blue) catches mid-period changes or invoice-side rounding.
  const NEAR_MATCH_PCT = 0.5;
  const [searchRaw, setSearchRaw] = useState('');
  const searchTarget = useMemo(() => parseVnd(searchRaw), [searchRaw]);
  const matchedKeys = useMemo(() => {
    const exact = new Set<string>();
    const near = new Set<string>();
    if (searchTarget === null) return { exact, near };
    for (const [key, str] of Object.entries(values)) {
      if (!str) continue;
      const amount = Number(str);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      if (amount === searchTarget) {
        exact.add(key);
        continue;
      }
      const gapPct = Math.abs(amount - searchTarget) / Math.max(amount, 1) * 100;
      if (gapPct <= NEAR_MATCH_PCT) near.add(key);
    }
    return { exact, near };
  }, [searchTarget, values]);

  function setCellState(key: string, s: CellState) {
    setState((prev) => ({ ...prev, [key]: s }));
  }

  if (zones.length === 0 || tiers.length === 0) {
    return (
      <div className="space-y-3">
        {toolbarStart && (
          <div className="flex flex-wrap items-center gap-3">{toolbarStart}</div>
        )}
        <div className="text-sm text-muted-foreground italic py-12 text-center">
          {zones.length === 0 && tiers.length === 0
            ? 'Define at least one zone and one weight tier before filling the matrix.'
            : zones.length === 0
              ? 'Define at least one zone to fill the matrix.'
              : 'Define at least one weight tier to fill the matrix.'}
        </div>
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
        nearMatchPct={NEAR_MATCH_PCT}
        target={searchTarget}
        toolbarStart={toolbarStart}
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
                className={
                  'text-right px-5 py-4 border-b-2 text-sm uppercase tracking-wide font-bold whitespace-nowrap ' +
                  (z.id === highlightZoneId
                    ? 'border-amber-400 text-amber-600 dark:text-amber-400'
                    : 'border-border text-foreground')
                }
                style={{ backgroundColor: 'var(--muted)' }}
              >
                {z.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tiers.map((t, i) => {
            const prev = t.prevKg ?? (i === 0 ? 0 : Number(tiers[i - 1].upperKg));
            const upper = Number(t.upperKg);
            const zebra = i % 2 === 1;
            const dataBg = zebra ? 'bg-muted/15' : '';
            const groupHeader = t.groupLabel ? (
              <tr key={`grp-${t.id}`}>
                <th
                  colSpan={zones.length + 1}
                  className="sticky left-0 z-20 text-left px-5 py-2 border-b-2 border-border text-[11px] uppercase tracking-wider font-bold text-muted-foreground"
                  style={{ backgroundColor: 'var(--muted)' }}
                >
                  {t.groupLabel}
                </th>
              </tr>
            ) : null;
            return (
              <Fragment key={t.id}>
              {groupHeader}
              <tr className={dataBg}>
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
                      zoneHighlighted={z.id === highlightZoneId}
                      matchTier={
                        matchedKeys.exact.has(key) ? 'exact'
                        : matchedKeys.near.has(key) ? 'near'
                        : null
                      }
                      onChange={(v) => setValues((p) => ({ ...p, [key]: v }))}
                      onCommit={async (v) => {
                        const trimmed = v.trim();
                        const isEmpty = trimmed === '';
                        const hadValue = (initialMap.get(key) ?? '') !== '';

                        if (isEmpty && hadValue) {
                          if (!clearCellAction) return;
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

                        if (!setCellAction) return;
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
              </Fragment>
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
  nearMatchPct: number;
  target: number | null;
  /** Node rendered to the left of the search input on the same flex row. */
  toolbarStart?: React.ReactNode;
}

interface MatrixMatch {
  zoneLabel: string;
  tierUpper: number;
  tierLower: number;
  amount: number;
  gapPct: number;
}

function MatrixSearch({
  values, zones, tiers, costCurrency,
  searchRaw: raw, onSearchChange: setRaw,
  nearMatchPct,
  target,
  toolbarStart,
}: MatrixSearchProps): React.ReactNode {
  // Two buckets — exact-equality vs within nearMatchPct.
  const matches = useMemo<{ exact: MatrixMatch[]; near: MatrixMatch[] }>(() => {
    if (target === null) return { exact: [], near: [] };
    const zonesById = new Map(zones.map((z) => [z.id, z]));
    const tiersById = new Map(tiers.map((t) => [t.id, t]));
    const sortedTiers = [...tiers].sort((a, b) => Number(a.upperKg) - Number(b.upperKg));
    const exact: MatrixMatch[] = [];
    const near: MatrixMatch[] = [];
    for (const [key, str] of Object.entries(values)) {
      if (!str) continue;
      const amount = Number(str);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const isExact = amount === target;
      const gapPct = Math.abs(amount - target) / Math.max(amount, 1) * 100;
      if (!isExact && gapPct > nearMatchPct) continue;
      const [zoneId, tierId] = key.split('|');
      const z = zonesById.get(zoneId);
      const t = tiersById.get(tierId);
      if (!z || !t) continue;
      const idx = sortedTiers.findIndex((x) => x.id === tierId);
      const lower = idx <= 0 ? 0 : Number(sortedTiers[idx - 1].upperKg);
      const m: MatrixMatch = {
        zoneLabel: z.label,
        tierUpper: Number(t.upperKg),
        tierLower: lower,
        amount,
        gapPct,
      };
      if (isExact) exact.push(m);
      else near.push(m);
    }
    exact.sort((a, b) => a.tierUpper - b.tierUpper);
    near.sort((a, b) => a.gapPct - b.gapPct);
    return { exact, near };
  }, [target, nearMatchPct, values, zones, tiers]);

  const exactCount = matches.exact.length;
  const nearCount = matches.near.length;
  const totalCount = exactCount + nearCount;

  return (
    <div className="rounded border border-border bg-muted/30 p-3 space-y-2">
      {toolbarStart && (
        <div className="flex flex-wrap items-center gap-3">{toolbarStart}</div>
      )}
      <div className="flex items-center gap-3">
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

      {/* Legend — only render when there's an active search. */}
      {target !== null && (
        <div className="flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-emerald-500/40 border border-emerald-500/60" />
            Exact match
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded bg-sky-500/40 border border-sky-500/60" />
            Near match (±{nearMatchPct}%)
          </span>
        </div>
      )}

      {target !== null && (
        totalCount === 0 ? (
          <p className="text-xs text-muted-foreground">
            Không có cell nào khớp{' '}
            <span className="font-mono font-medium">{formatMoneyForDisplay(String(target))}</span>
            {' '}{costCurrency} (±{nearMatchPct}%).
            Có thể số đã được carrier cộng thêm fuel / VAT / discount.
          </p>
        ) : (
          <div className="text-xs space-y-2">
            <p className="text-muted-foreground">
              <span className="font-semibold text-foreground">{totalCount}</span>{' '}
              {totalCount === 1 ? 'match' : 'matches'} cho{' '}
              <span className="font-mono font-medium">{formatMoneyForDisplay(String(target))}</span>{' '}
              {costCurrency}
              {exactCount > 0 && (
                <> — <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{exactCount}</span> exact</>
              )}
              {nearCount > 0 && (
                <>{exactCount > 0 ? ', ' : ' — '}<span className="text-sky-600 dark:text-sky-400 font-semibold">{nearCount}</span> near</>
              )}
            </p>
            {exactCount > 0 && (
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 font-mono">
                {matches.exact.slice(0, 30).map((m, i) => (
                  <li key={`e${i}`} className="bg-emerald-500/15 dark:bg-emerald-500/10 border border-emerald-500/40 rounded px-2 py-1">
                    <span className="font-semibold">{m.zoneLabel}</span>
                    {' '}@ {fmtKg(m.tierLower)}–{fmtKg(m.tierUpper)} kg
                    {' = '}
                    <span className="font-semibold">{formatMoneyForDisplay(String(Math.round(m.amount)))}</span>
                  </li>
                ))}
              </ul>
            )}
            {nearCount > 0 && (
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1 font-mono">
                {matches.near.slice(0, 30).map((m, i) => (
                  <li key={`n${i}`} className="bg-sky-500/15 dark:bg-sky-500/10 border border-sky-500/40 rounded px-2 py-1">
                    <span className="font-semibold">{m.zoneLabel}</span>
                    {' '}@ {fmtKg(m.tierLower)}–{fmtKg(m.tierUpper)} kg
                    {' = '}
                    <span className="font-semibold">{formatMoneyForDisplay(String(Math.round(m.amount)))}</span>
                    <span className="text-muted-foreground"> (Δ {m.gapPct.toFixed(2)}%)</span>
                  </li>
                ))}
              </ul>
            )}
            {(exactCount > 30 || nearCount > 30) && (
              <p className="text-muted-foreground italic">… mỗi nhóm cap 30 chip, anh xem trong matrix các cell highlight.</p>
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
  /** Match tier for the search box highlight. 'exact' = identical to
   *  the target amount, 'near' = within NEAR_MATCH_PCT but not exact,
   *  null = no match (no highlight). Drives the cell background only. */
  matchTier: 'exact' | 'near' | null;
  zoneHighlighted?: boolean;
  onChange: (v: string) => void;
  onCommit: (v: string) => Promise<void>;
}

function Cell({ value, state, currency, canEdit, matchTier, zoneHighlighted = false, onChange, onCommit }: CellProps) {
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

  const highlightBg =
    matchTier === 'exact' ? 'bg-emerald-500/30 dark:bg-emerald-500/25'
    : matchTier === 'near' ? 'bg-sky-500/30 dark:bg-sky-500/25'
    : '';

  if (!canEdit) {
    return (
      <td className={
        `px-5 py-3 border-b tabular-nums text-right whitespace-nowrap text-foreground ${highlightBg} ` +
        (zoneHighlighted ? 'border-amber-400/40 bg-amber-400/[0.06]' : 'border-border')
      }>
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
