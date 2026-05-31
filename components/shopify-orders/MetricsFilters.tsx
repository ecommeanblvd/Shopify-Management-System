'use client';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';

interface MetricsFiltersProps {
  defaultFrom: string;
  defaultTo: string;
  defaultVendor: string[];
  showVendor: boolean;
  availableVendors: string[];
}

const PRESETS: Array<{ label: string; days: number }> = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'YTD', days: 0 }, // 0 means start of year
];

export function MetricsFilters({
  defaultFrom,
  defaultTo,
  defaultVendor,
  showVendor,
  availableVendors,
}: MetricsFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const update = (patch: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    startTransition(() => router.replace(`${pathname}?${next.toString()}`));
  };

  const applyPreset = (days: number): void => {
    const to = new Date();
    let from: Date;
    if (days === 0) {
      from = new Date(to.getFullYear(), 0, 1);
    } else {
      from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    }
    update({ from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  };

  const toggleVendor = (v: string): void => {
    const set = new Set(defaultVendor);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    update({ vendor: set.size > 0 ? [...set].join(',') : null });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <div className="flex items-center gap-1.5">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => applyPreset(p.days)}
            className="h-7 px-2 text-xs"
          >
            {p.label}
          </Button>
        ))}
      </div>

      <label className="flex items-center gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">From</span>
        <input
          type="date"
          defaultValue={defaultFrom}
          onChange={(e) => update({ from: e.target.value })}
          className="h-7 border border-input bg-input/30 rounded-md px-2 text-xs"
        />
      </label>

      <label className="flex items-center gap-1.5">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">To</span>
        <input
          type="date"
          defaultValue={defaultTo}
          onChange={(e) => update({ to: e.target.value })}
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
              variant={defaultVendor.includes(v) ? 'default' : 'outline'}
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
