const ISO2_RE = /^[A-Z]{2}$/;
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

function countryName(code: string): string {
  if (!ISO2_RE.test(code)) return code;
  try {
    const name = REGION_NAMES.of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

export interface SearchableZone {
  id: string;
  label: string;
  countries: string[];
}

export interface CountryMatch {
  code: string;
  name: string;
  zoneId: string;
  zoneLabel: string;
  /** How many *other* countries also matched the query (beyond the one returned). */
  otherCount: number;
}

/**
 * Map a free-text query (country name or ISO-2 code) to the zone that
 * contains it. Code matches take priority over name-substring matches.
 * Returns the first match in zone/country order, plus a count of any
 * additional matches so the UI can show "+N more".
 */
export function matchCountryToZone(query: string, zones: SearchableZone[]): CountryMatch | null {
  const q = query.trim();
  if (!q) return null;
  const upper = q.toUpperCase();
  const lower = q.toLowerCase();

  const all: Array<{ code: string; zoneId: string; zoneLabel: string }> = [];
  for (const z of zones) {
    for (const code of z.countries) {
      all.push({ code, zoneId: z.id, zoneLabel: z.label });
    }
  }

  // 1) Exact ISO-2 code match wins.
  const byCode = all.filter((c) => c.code.toUpperCase() === upper);
  // 2) Otherwise, name substring match.
  const byName = all.filter((c) => countryName(c.code).toLowerCase().includes(lower));

  const pool = byCode.length > 0 ? byCode : byName;
  if (pool.length === 0) return null;

  const first = pool[0];
  return {
    code: first.code,
    name: countryName(first.code),
    zoneId: first.zoneId,
    zoneLabel: first.zoneLabel,
    otherCount: pool.length - 1,
  };
}
