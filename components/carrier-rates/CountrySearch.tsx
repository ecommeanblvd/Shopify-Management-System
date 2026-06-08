'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { matchCountryToZone, type SearchableZone, type CountryMatch } from '@/features/carrier-rates/country-search-match';
import { iso2ToFlag } from '@/components/carrier-rates/country-display';

interface Props {
  zones: SearchableZone[];
  /** Called whenever the matched zone changes (null when no match / empty). */
  onMatch: (match: CountryMatch | null) => void;
}

export function CountrySearch({ zones, onMatch }: Props) {
  const [query, setQuery] = useState('');
  const match = useMemo(() => matchCountryToZone(query, zones), [query, zones]);

  // Lift the result up so the page can highlight the matrix column + zone card.
  useEffect(() => {
    onMatch(match);
  }, [match, onMatch]);

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm country theo tên hoặc mã ISO-2 (vd: Japan, JP) → thuộc zone nào"
            className="text-sm h-9 pl-9 pr-3 rounded border border-border bg-background w-full focus:outline-none focus:ring-2 focus:ring-foreground/20"
          />
        </div>
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-xs px-2 h-9 rounded border border-border hover:bg-background inline-flex items-center gap-1"
          >
            <X className="size-3" /> Clear
          </button>
        )}
      </div>

      {query.trim() !== '' && (
        match === null ? (
          <p className="text-xs text-muted-foreground">
            Không tìm thấy country khớp &ldquo;<span className="font-medium">{query.trim()}</span>&rdquo; trong bất kỳ zone nào.
          </p>
        ) : (
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <span className="text-lg leading-none" aria-hidden>{iso2ToFlag(match.code)}</span>
            <span>
              <b>{match.name} ({match.code})</b> thuộc <b>{match.zoneLabel}</b>
              {match.otherCount > 0 && (
                <span className="text-muted-foreground"> · +{match.otherCount} country khác cũng khớp</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                document.getElementById(`zone-${match.zoneId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              className="ml-auto text-xs underline text-amber-700 dark:text-amber-300 hover:opacity-80"
            >
              cuộn tới {match.zoneLabel} ↓
            </button>
          </div>
        )
      )}
    </div>
  );
}
