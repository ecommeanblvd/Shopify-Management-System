# Carrier Rate Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gộp Zones + Rate Matrix của một carrier account thành một trang `/workspace` read-only, xếp dọc (matrix trên, zones dưới), có search country → zone với highlight.

**Architecture:** Server component `workspace/page.tsx` load data (read-only) rồi truyền xuống một client orchestrator `RateWorkspace` giữ state `matchedZoneId`. Search logic là module thuần (`country-search-match.ts`) test được bằng vitest. `RateMatrix` tái dùng ở chế độ `canEdit={false}` + thêm prop `highlightZoneId`. `CountryChip` + helpers tách ra file dùng chung.

**Tech Stack:** Next.js (bản custom trong `node_modules/next/dist/docs/` — đọc trước khi viết route/server-action), React client components, Drizzle, vitest, Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-08-carrier-rate-workspace-design.md`

---

## File Structure

- **Create** `features/carrier-rates/country-search-match.ts` — pure matching: input string → `{ code, zoneId, zoneLabel } | null` (+ helper count). Testable.
- **Create** `features/carrier-rates/country-search-match.test.ts` — unit tests.
- **Create** `components/carrier-rates/country-display.tsx` — `iso2ToFlag`, `countryName`, `CountryChip` (tách từ `zones/page.tsx`).
- **Create** `components/carrier-rates/CountrySearch.tsx` — client search input + result banner; calls back with matched result.
- **Create** `components/carrier-rates/RateWorkspace.tsx` — client orchestrator; matrix + zones + search; holds `matchedZoneId`.
- **Create** `app/(dashboard)/f/carrier-rates/[id]/workspace/page.tsx` — server component.
- **Modify** `components/carrier-rates/RateMatrix.tsx` — add optional `highlightZoneId`; make `setCellAction`/`clearCellAction` optional.
- **Modify** `app/(dashboard)/f/carrier-rates/[id]/page.tsx` — merge two SubSections into one "Rate workspace".
- **Modify** `app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx` — replace body with redirect to `/workspace`.
- **Modify** `app/(dashboard)/f/carrier-rates/[id]/calculator/page.tsx` — repoint two links to `/workspace`.
- **Keep untouched** `app/(dashboard)/f/carrier-rates/[id]/zones/page.tsx` (hidden admin-seed route; refactor only its `CountryChip` import) + import from shared `country-display.tsx`.

---

### Task 1: Shared country-display module

**Files:**
- Create: `components/carrier-rates/country-display.tsx`
- Modify: `app/(dashboard)/f/carrier-rates/[id]/zones/page.tsx`

- [ ] **Step 1: Create the shared module**

Create `components/carrier-rates/country-display.tsx`:

```tsx
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
```

- [ ] **Step 2: Repoint the zones page to the shared module**

In `app/(dashboard)/f/carrier-rates/[id]/zones/page.tsx`:
1. Add import near the other component imports:
   ```tsx
   import { iso2ToFlag, countryName, CountryChip } from '@/components/carrier-rates/country-display';
   ```
2. Delete the local `ISO2_RE` const **only if** it is no longer referenced after removal. Note: `ISO2_RE` is still used by `ZoneEditCard` (validCountries filter) and `setCountriesAction`. So KEEP the local `ISO2_RE` const. DELETE only the local `FLAG_OFFSET`, `iso2ToFlag`, `REGION_NAMES`, `countryName`, and the local `CountryChip` function (lines defining them) — they now come from the import.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no unused-symbol or missing-import errors in zones page).

- [ ] **Step 4: Commit**

```bash
git add components/carrier-rates/country-display.tsx "app/(dashboard)/f/carrier-rates/[id]/zones/page.tsx"
git commit -m "refactor(carrier-rates): extract shared CountryChip + helpers"
```

---

### Task 2: Pure country→zone search matcher (TDD)

**Files:**
- Create: `features/carrier-rates/country-search-match.ts`
- Test: `features/carrier-rates/country-search-match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `features/carrier-rates/country-search-match.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchCountryToZone, type SearchableZone } from './country-search-match';

const ZONES: SearchableZone[] = [
  { id: 'z1', label: 'Zone 1', countries: ['VN', 'TH'] },
  { id: 'z2', label: 'Zone 2', countries: ['SG', 'MY'] },
  { id: 'z3', label: 'Zone 3', countries: ['JP', 'KR'] },
];

describe('matchCountryToZone', () => {
  it('returns null for empty query', () => {
    expect(matchCountryToZone('', ZONES)).toBeNull();
    expect(matchCountryToZone('   ', ZONES)).toBeNull();
  });

  it('matches by ISO-2 code, case-insensitive', () => {
    expect(matchCountryToZone('jp', ZONES)).toEqual({
      code: 'JP', zoneId: 'z3', zoneLabel: 'Zone 3', name: 'Japan', otherCount: 0,
    });
  });

  it('matches by country name substring, case-insensitive', () => {
    const r = matchCountryToZone('japa', ZONES);
    expect(r?.code).toBe('JP');
    expect(r?.zoneId).toBe('z3');
  });

  it('returns null when no country matches', () => {
    expect(matchCountryToZone('atlantis', ZONES)).toBeNull();
  });

  it('reports otherCount when multiple countries match the name query', () => {
    const zones: SearchableZone[] = [
      { id: 'a', label: 'A', countries: ['US'] }, // United States
      { id: 'b', label: 'B', countries: ['GB'] }, // United Kingdom
    ];
    const r = matchCountryToZone('united', zones);
    expect(r).not.toBeNull();
    expect(r?.otherCount).toBe(1); // one match returned, one extra
  });

  it('prefers an exact ISO-2 match over a name substring match', () => {
    // 'MY' is Malaysia (code). 'my' should match by code → Malaysia, not a
    // name containing "my".
    const r = matchCountryToZone('MY', ZONES);
    expect(r?.code).toBe('MY');
    expect(r?.zoneId).toBe('z2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- country-search-match`
Expected: FAIL — cannot resolve `./country-search-match`.

- [ ] **Step 3: Write minimal implementation**

Create `features/carrier-rates/country-search-match.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- country-search-match`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add features/carrier-rates/country-search-match.ts features/carrier-rates/country-search-match.test.ts
git commit -m "feat(carrier-rates): country→zone search matcher"
```

---

### Task 3: Make RateMatrix support read-only highlight

**Files:**
- Modify: `components/carrier-rates/RateMatrix.tsx`

- [ ] **Step 1: Make edit actions optional + add highlightZoneId prop**

In `components/carrier-rates/RateMatrix.tsx`, update the `Props` interface:

```tsx
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
  toolbarStart?: React.ReactNode;
}
```

- [ ] **Step 2: Thread the prop through the component signature**

Update the destructure on the `export function RateMatrix(...)` line to include `highlightZoneId`:

```tsx
export function RateMatrix({ zones, tiers, initialCells, costCurrency, canEdit, setCellAction, clearCellAction, highlightZoneId = null, toolbarStart }: Props) {
```

- [ ] **Step 3: Guard the action calls (they are now optional)**

In the `onCommit` handler, replace the two action calls so they no-op safely when undefined:

- Replace `await clearCellAction({ zoneId: z.id, tierId: t.id });` with:
  ```tsx
  if (!clearCellAction) return;
  await clearCellAction({ zoneId: z.id, tierId: t.id });
  ```
- Replace `await setCellAction({ zoneId: z.id, tierId: t.id, costAmount: canonical });` with:
  ```tsx
  if (!setCellAction) return;
  await setCellAction({ zoneId: z.id, tierId: t.id, costAmount: canonical });
  ```

(These paths only run when `canEdit` is true, which the workspace never sets — this is belt-and-suspenders.)

- [ ] **Step 4: Highlight the matched zone column header**

In the `<thead>` zone header map, change the `<th>` for zones to add a conditional class. Replace the existing zone-header `<th>` block with:

```tsx
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
```

- [ ] **Step 5: Highlight the matched zone column cells**

Pass a `zoneHighlighted` flag into `Cell`. In the `zones.map((z) => { ... })` body inside `<tbody>`, add `zoneHighlighted={z.id === highlightZoneId}` to the `<Cell ... />` props. Then extend `CellProps` and `Cell` to use it.

In `CellProps`, add:
```tsx
  zoneHighlighted?: boolean;
```

In `Cell` destructure, add `zoneHighlighted = false`, and combine it into the read-only `<td>` className. Replace the `if (!canEdit)` block's `<td>` with:

```tsx
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
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS. The existing matrix page passes `setCellAction`/`clearCellAction` (still valid since optional). No call site breaks.

- [ ] **Step 7: Commit**

```bash
git add components/carrier-rates/RateMatrix.tsx
git commit -m "feat(carrier-rates): RateMatrix read-only highlightZoneId support"
```

---

### Task 4: CountrySearch client component

**Files:**
- Create: `components/carrier-rates/CountrySearch.tsx`

- [ ] **Step 1: Create the component**

Create `components/carrier-rates/CountrySearch.tsx`:

```tsx
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
            Không tìm thấy country khớp “<span className="font-medium">{query.trim()}</span>” trong bất kỳ zone nào.
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/carrier-rates/CountrySearch.tsx
git commit -m "feat(carrier-rates): CountrySearch client component"
```

---

### Task 5: RateWorkspace orchestrator

**Files:**
- Create: `components/carrier-rates/RateWorkspace.tsx`

- [ ] **Step 1: Create the orchestrator**

Create `components/carrier-rates/RateWorkspace.tsx`:

```tsx
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
  zonesWithCountries: SearchableZone[];
  costCurrency: string;
  toolbarStart?: React.ReactNode;
}

export function RateWorkspace({ matrixZones, tiers, cells, zonesWithCountries, costCurrency, toolbarStart }: Props) {
  const [match, setMatch] = useState<CountryMatch | null>(null);

  return (
    <div className="space-y-10">
      <CountrySearch zones={zonesWithCountries} onMatch={setMatch} />

      <section className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Coins className="size-3.5" /> Rate matrix · cost (zone × tier)
        </div>
        <RateMatrix
          zones={matrixZones}
          tiers={tiers}
          initialCells={cells}
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
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Confirms `MatrixZone`/`MatrixTier`/`MatrixInitialCell` are exported from RateMatrix — they are.)

- [ ] **Step 3: Commit**

```bash
git add components/carrier-rates/RateWorkspace.tsx
git commit -m "feat(carrier-rates): RateWorkspace orchestrator (matrix + zones + search)"
```

---

### Task 6: Workspace page (server component)

**Files:**
- Create: `app/(dashboard)/f/carrier-rates/[id]/workspace/page.tsx`

- [ ] **Step 1: Read the Next.js guide for this codebase**

This is NOT standard Next.js. Before writing the route, read the relevant routing/server-component guide:

Run: `ls node_modules/next/dist/docs/` then read the routing + server-component pages.
Confirm: `params`/`searchParams` are Promises (matched by existing pages), `dynamic = 'force-dynamic'` is valid.

- [ ] **Step 2: Create the page**

Create `app/(dashboard)/f/carrier-rates/[id]/workspace/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { ChevronLeft, LayoutGrid } from 'lucide-react';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { getAccount } from '@/features/carrier-rates/actions';
import { loadMatrix } from '@/features/carrier-rates/matrix-actions';
import { listZonesWithCountries } from '@/features/carrier-rates/zones-actions';
import { listRateCardsForAccount, getCurrentCardId } from '@/features/carrier-rates/rate-cards-actions';
import { stageRateCardPdf, commitRateCardFromPdf } from '@/features/carrier-rates/rate-card-upload-actions';
import { RateCardSelect } from '@/components/carrier-rates/RateCardSelect';
import { RateCardUploadDialog } from '@/components/carrier-rates/RateCardUploadDialog';
import { RateWorkspace } from '@/components/carrier-rates/RateWorkspace';

export const dynamic = 'force-dynamic';

async function stageRateCardAction(accountId: string, formData: FormData) {
  'use server';
  const file = formData.get('file') as File;
  return stageRateCardPdf(accountId, file);
}

async function commitRateCardAction(
  accountId: string,
  input: { pdfKey: string; filename: string; effectiveFrom: string; effectiveTo: string | null },
) {
  'use server';
  const r = await commitRateCardFromPdf({ carrierAccountId: accountId, ...input });
  revalidatePath(`/f/carrier-rates/${accountId}/workspace`);
  return r;
}

export default async function WorkspacePage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ card?: string }> }) {
  const { id } = await params;
  const { card: cardParam } = await searchParams;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center"><h1 className="text-3xl font-semibold">Forbidden</h1></div>;
  }
  const account = await getAccount(id);
  if (!account) notFound();

  const canManage = hasPermission(role, 'manage_carrier_rates');
  const cards = await listRateCardsForAccount(id);
  const selectedCardId = (cardParam && cards.some((c) => c.id === cardParam))
    ? cardParam
    : (await getCurrentCardId(id)) ?? cards[cards.length - 1]?.id ?? null;

  const stageBound = stageRateCardAction.bind(null, id);
  const commitBound = commitRateCardAction.bind(null, id);

  const backLink = (
    <Link href={`/f/carrier-rates/${id}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
      <ChevronLeft className="size-4" />
      {account.name}
    </Link>
  );

  if (!selectedCardId) {
    return (
      <div className="px-6 md:px-10 py-12 space-y-6">
        {backLink}
        <h1 className="text-3xl font-semibold">No rate card yet</h1>
        <p className="text-sm text-muted-foreground">Upload a carrier rate-sheet PDF to create the first card.</p>
        {canManage && (
          <RateCardUploadDialog
            stageAction={stageBound}
            commitAction={commitBound}
            triggerLabel="Upload first rate card"
            triggerVariant="default"
          />
        )}
      </div>
    );
  }

  const selectedCard = cards.find((c) => c.id === selectedCardId) ?? null;
  const { zones: matrixZones, tiers, cells } = await loadMatrix(id, selectedCardId);
  const zonesWithCountries = await listZonesWithCountries(id);

  const toolbarStart = (
    <div className="flex flex-wrap items-center gap-3">
      <span className="text-xs uppercase tracking-wider text-muted-foreground whitespace-nowrap">Rate card</span>
      <RateCardSelect accountId={id} cards={cards} selectedCardId={selectedCardId} />
      {selectedCard?.hasPdf && (
        <a
          href={`/f/carrier-rates/${id}/cards/${selectedCardId}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs underline text-muted-foreground hover:text-foreground whitespace-nowrap"
        >
          View source PDF
        </a>
      )}
      {selectedCard && (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          Effective: {selectedCard.effectiveFrom}{selectedCard.effectiveTo ? ` → ${selectedCard.effectiveTo}` : ' → (open)'}
        </span>
      )}
    </div>
  );

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-10">
      {backLink}

      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <LayoutGrid className="size-3.5" />
          Rate workspace
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Zones &amp; rate matrix</h1>
          {canManage && (
            <div className="ml-auto shrink-0">
              <RateCardUploadDialog stageAction={stageBound} commitAction={commitBound} />
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground max-w-xl">
          Chỉ xem. Mọi giá trị đến từ rate card đã upload (source of truth). Tìm country bên dưới để biết nó thuộc zone nào.
        </p>
      </header>

      <RateWorkspace
        matrixZones={matrixZones}
        tiers={tiers.map((t) => ({ id: t.id, upperKg: t.upperKg }))}
        cells={cells
          .filter((c): c is typeof c & { costAmount: string } => c.costAmount !== null)
          .map((c) => ({ zoneId: c.zoneId, tierId: c.tierId, costAmount: c.costAmount }))}
        zonesWithCountries={zonesWithCountries.map((z) => ({ id: z.id, label: z.label, countries: z.countries }))}
        costCurrency={account.costCurrency}
        toolbarStart={toolbarStart}
      />
    </div>
  );
}
```

> Note: `selectedCard.effectiveFrom` / `effectiveTo` / `hasPdf` come from `listRateCardsForAccount` — confirm these fields exist on that return type (the matrix page already reads `selectedCard.hasPdf`, `.effectiveFrom`, `.effectiveTo`). If `MatrixTier.upperKg` typing differs, the `.map` already narrows to `{ id, upperKg }`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Build the route**

Run: `npm run build`
Expected: PASS — `/f/carrier-rates/[id]/workspace` compiles.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/f/carrier-rates/[id]/workspace/page.tsx"
git commit -m "feat(carrier-rates): read-only rate workspace page"
```

---

### Task 7: Wire navigation — detail page, matrix redirect, calculator links

**Files:**
- Modify: `app/(dashboard)/f/carrier-rates/[id]/page.tsx`
- Modify: `app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx`
- Modify: `app/(dashboard)/f/carrier-rates/[id]/calculator/page.tsx`

- [ ] **Step 1: Merge the two SubSections on the detail page**

In `app/(dashboard)/f/carrier-rates/[id]/page.tsx`, delete the two `<SubSection>` blocks for "Zones" (`/zones`) and "Rate matrix" (`/matrix`) and replace them with a single block placed where the "Zones" one was:

```tsx
        <SubSection
          href={`/f/carrier-rates/${id}/workspace`}
          icon={<LayoutGrid className="size-4" />}
          title="Rate workspace"
          desc="Zones + rate matrix trong một trang read-only. Search country → zone."
          status="Ready"
          accent
        />
```

Add `LayoutGrid` to the lucide import line at the top (remove `Globe2` and `Coins` from the import **only if** they are no longer used elsewhere in the file — check first; they are used only by these two SubSections, so they can be removed).

- [ ] **Step 2: Replace the matrix page with a redirect**

Replace the **entire contents** of `app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx` with:

```tsx
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function MatrixRedirect({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ card?: string }> }) {
  const { id } = await params;
  const { card } = await searchParams;
  redirect(`/f/carrier-rates/${id}/workspace${card ? `?card=${card}` : ''}`);
}
```

- [ ] **Step 3: Repoint the calculator links**

In `app/(dashboard)/f/carrier-rates/[id]/calculator/page.tsx`:
- Change `href={`/f/carrier-rates/${id}/zones`}` (the "Configure zones →" link) to `href={`/f/carrier-rates/${id}/workspace`}`.
- Change `href={`/f/carrier-rates/${id}/matrix`}` (the "Fill matrix →" link) to `href={`/f/carrier-rates/${id}/workspace`}`.
- Optionally update the link text "Fill matrix →" to "Open rate workspace →" and "Configure zones →" to "Open rate workspace →" (or leave as-is — your call; both now go to workspace).

- [ ] **Step 4: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS. No dangling imports on the detail page; matrix redirect compiles.

- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/f/carrier-rates/[id]/page.tsx" "app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx" "app/(dashboard)/f/carrier-rates/[id]/calculator/page.tsx"
git commit -m "feat(carrier-rates): route navigation to unified workspace"
```

---

### Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `npm test`
Expected: PASS (including new `country-search-match` tests; existing `matrix-actions.test.ts` unaffected).

- [ ] **Step 2: Typecheck + lint + build**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 3: Manual smoke (dev server)**

Run the app, open a carrier account with an existing rate card. Verify:
- Detail page shows one "Rate workspace" card (no separate Zones/Rate matrix cards).
- `/f/carrier-rates/<id>/workspace` shows: rate card selector + upload button, search box, matrix (read-only — clicking a cell does nothing/no input), zones below.
- Typing a country name (e.g. "japan") or code ("JP") shows the banner with the zone, highlights that zone's matrix column header + cells, highlights the zone card + the matched country chip, and "cuộn tới" scrolls to the card.
- Visiting `/f/carrier-rates/<id>/matrix` redirects to `/workspace`.
- Calculator "Open rate workspace →" links go to `/workspace`.

- [ ] **Step 4: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(carrier-rates): workspace verification tweaks"
```

---

## Self-Review Notes

- **Spec coverage:** stacked layout (Task 5/6), country→zone search (Task 2/4), highlight matrix column + zone card (Task 3/4/5), read-only / no edit forms (Task 6 uses `canEdit={false}`, no server write actions), merge detail nav + `/matrix` redirect + keep `/zones` hidden (Task 1 keeps zones page, Task 7 removes its links), shared CountryChip (Task 1). Open dependency (no upload-based zone ingestion) is documented in the spec and the `/zones` page is intentionally left intact as the hidden seed path.
- **Read-only guarantee:** workspace passes `canEdit={false}` and omits `setCellAction`/`clearCellAction`; the matrix's edit branches are unreachable.
- **Type consistency:** `SearchableZone`/`CountryMatch` defined in Task 2 and consumed in Tasks 4–6; `MatrixZone`/`MatrixTier`/`MatrixInitialCell` imported from RateMatrix; `matchCountryToZone` name consistent across tasks.
