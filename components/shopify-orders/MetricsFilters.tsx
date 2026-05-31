'use client';

import { Zap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MetricsFiltersProps {
  /** Current filter window. Controlled by the parent (`OrdersBoard`). */
  from: string;
  to: string;
  vendor: string[];

  showVendor: boolean;
  availableVendors: string[];

  /** Inclusive bounds of the warmed server cache. Used to label preset
   *  buttons as "instant" or "needs refetch". */
  cacheFromISO: string;
  cacheToISO: string;

  /** True while the parent's `router.replace` is mid-flight. Disables
   *  controls so the operator can't queue up conflicting refetches. */
  pending: boolean;

  onChange: (patch: { from?: string; to?: string; vendor?: string[] }) => void;
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'YTD', days: 0 }, // 0 means start of year
];

/**
 * Read-only date helpers — accept a snapshot millis so we don't tickle
 * React 19's purity rule by calling Date.now() during render.
 */
function presetWindow(days: number, todayMs: number): { from: string; to: string } {
  const today = new Date(todayMs);
  const to = today.toISOString().slice(0, 10);
  let fromDate: Date;
  if (days === 0) {
    fromDate = new Date(today.getFullYear(), 0, 1);
  } else {
    fromDate = new Date(todayMs - days * 24 * 60 * 60 * 1000);
  }
  return { from: fromDate.toISOString().slice(0, 10), to };
}

export function MetricsFilters({
  from,
  to,
  vendor,
  showVendor,
  availableVendors,
  cacheFromISO,
  cacheToISO,
  pending,
  onChange,
}: MetricsFiltersProps) {
  // Snap the wall clock once per render so preset windows are stable
  // across the render pass (and don't drift between the comparison
  // below and the actual onChange firing).
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const applyPreset = (days: number): void => {
    onChange(presetWindow(days, nowMs));
  };

  const toggleVendor = (v: string): void => {
    const set = new Set(vendor);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChange({ vendor: [...set] });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <div className="flex items-center gap-1.5">
        {PRESETS.map((p) => {
          const w = presetWindow(p.days, nowMs);
          const insideCache = w.from >= cacheFromISO && w.to <= cacheToISO;
          const active = w.from === from && w.to === to;
          return (
            <Button
              key={p.label}
              size="sm"
              variant={active ? 'default' : 'outline'}
              disabled={pending}
              onClick={() => applyPreset(p.days)}
              className="h-7 px-2 text-xs gap-1"
              title={
                insideCache
                  ? 'Instant — filters the loaded window without a server roundtrip'
                  : 'Will fetch from the server'
              }
            >
              {p.label}
              {insideCache && <Zap className="size-2.5 text-amber-500" aria-hidden />}
            </Button>
          );
        })}
        {pending && (
          <Loader2 className="size-3.5 animate-spin text-muted-foreground ml-1" aria-label="loading" />
        )}
      </div>

      <label className="flex items-center gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => onChange({ from: e.target.value })}
          className="h-7 border border-input bg-input/30 rounded-md px-2 text-xs"
        />
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => onChange({ to: e.target.value })}
          className="h-7 border border-input bg-input/30 rounded-md px-2 text-xs"
        />
      </label>

      {showVendor && availableVendors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Vendor</span>
          {availableVendors.map((v) => (
            <Button
              key={v}
              size="sm"
              variant={vendor.includes(v) ? 'default' : 'outline'}
              onClick={() => toggleVendor(v)}
              disabled={pending}
              className="h-6 px-2 text-[11px]"
            >
              {v}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
