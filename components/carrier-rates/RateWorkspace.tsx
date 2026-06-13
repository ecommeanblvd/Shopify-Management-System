'use client';

import { useState } from 'react';
import { Coins, Globe2 } from 'lucide-react';
import { RateMatrix, type MatrixZone, type MatrixTier, type MatrixInitialCell } from '@/components/carrier-rates/RateMatrix';
import { CountrySearch } from '@/components/carrier-rates/CountrySearch';
import { CountryChip } from '@/components/carrier-rates/country-display';
import type { SearchableZone, CountryMatch } from '@/features/carrier-rates/country-search-match';

interface Props {
  matrixZones: MatrixZone[];
  tiers: MatrixTier[];
  cells: MatrixInitialCell[];
  /** Bậc + cells loại PAK (FedEx). Rỗng → không hiện khối PAK (vd DHL). */
  pakTiers?: MatrixTier[];
  pakCells?: MatrixInitialCell[];
  zonesWithCountries: SearchableZone[];
  costCurrency: string;
  toolbarStart?: React.ReactNode;
}

export function RateWorkspace({ matrixZones, tiers, cells, pakTiers = [], pakCells = [], zonesWithCountries, costCurrency, toolbarStart }: Props) {
  const [match, setMatch] = useState<CountryMatch | null>(null);
  const hasPak = pakTiers.length > 0 && pakCells.length > 0;

  // Gộp PAK (trên) + Package (dưới) vào MỘT bảng: chung header zone + 1 search.
  // Id dòng prefix theo nhóm vì PAK & Package dùng chung tier id ở bậc thấp.
  const buildRows = (ts: MatrixTier[], gp: 'pak' | 'pkg', label: string): MatrixTier[] =>
    ts.map((t, i) => ({
      id: `${gp}:${t.id}`,
      upperKg: t.upperKg,
      prevKg: i === 0 ? 0 : Number(ts[i - 1].upperKg),
      groupLabel: i === 0 ? label : undefined,
    }));
  const remap = (cs: MatrixInitialCell[], gp: 'pak' | 'pkg'): MatrixInitialCell[] =>
    cs.map((c) => ({ ...c, tierId: `${gp}:${c.tierId}` }));

  const mergedTiers = hasPak ? [...buildRows(pakTiers, 'pak', 'PAK'), ...buildRows(tiers, 'pkg', 'Package · hộp')] : tiers;
  const mergedCells = hasPak ? [...remap(pakCells, 'pak'), ...remap(cells, 'pkg')] : cells;

  return (
    <div className="space-y-10">
      <CountrySearch zones={zonesWithCountries} onMatch={setMatch} />

      <section className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Coins className="size-3.5" /> Rate matrix · cost (zone × tier){hasPak ? ' — PAK + Package' : ''}
        </div>
        <RateMatrix
          zones={matrixZones}
          tiers={mergedTiers}
          initialCells={mergedCells}
          costCurrency={costCurrency}
          canEdit={false}
          highlightZoneId={match?.zoneId ?? null}
          toolbarStart={toolbarStart}
        />
      </section>

      <section className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Globe2 className="size-3.5" /> Zones · country → zone
        </div>
        {zonesWithCountries.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">Chưa có zone nào.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {zonesWithCountries.map((z) => {
              const active = match?.zoneId === z.id;
              return (
                <div
                  key={z.id}
                  id={`zone-${z.id}`}
                  className={
                    'rounded-xl border p-5 transition-colors ' +
                    (active ? 'border-amber-400 bg-amber-400/[0.06] ring-1 ring-amber-400' : 'border-border bg-card')
                  }
                >
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <h3 className="text-lg font-semibold tracking-tight">{z.label}</h3>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {z.countries.length} {z.countries.length === 1 ? 'country' : 'countries'}
                    </span>
                  </div>
                  {z.countries.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Chưa có country.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {z.countries.map((c) => (
                        <CountryChip key={c} code={c} highlighted={active && c === match?.code} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
