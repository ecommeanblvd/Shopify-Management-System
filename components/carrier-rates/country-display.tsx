const ISO2_RE = /^[A-Z]{2}$/;
const FLAG_OFFSET = 0x1f1e6 - 'A'.charCodeAt(0);

export function iso2ToFlag(code: string): string {
  if (!ISO2_RE.test(code)) return '🏳️';
  return [...code].map((c) => String.fromCodePoint(c.charCodeAt(0) + FLAG_OFFSET)).join('');
}

// Intl.DisplayNames is in Node 18+ and every modern browser. Instantiate once.
const REGION_NAMES = new Intl.DisplayNames(['en'], { type: 'region' });

export function countryName(code: string): string {
  if (!ISO2_RE.test(code)) return code;
  try {
    const name = REGION_NAMES.of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

export function CountryChip({ code, highlighted = false }: { code: string; highlighted?: boolean }) {
  const flag = iso2ToFlag(code);
  const name = countryName(code);
  return (
    <div
      className={
        'inline-flex items-center gap-2.5 rounded-lg border bg-card pl-2 pr-3 py-1.5 transition-colors ' +
        (highlighted ? 'border-amber-400 bg-amber-400/10 ring-1 ring-amber-400' : 'border-border hover:border-foreground/30')
      }
      title={code}
    >
      <span className="text-2xl leading-none" aria-hidden>{flag}</span>
      <span className="text-sm font-medium text-foreground whitespace-nowrap">{name}</span>
    </div>
  );
}
