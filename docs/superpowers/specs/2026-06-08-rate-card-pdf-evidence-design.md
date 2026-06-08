# Rate Cards: PDF-driven creation + R2 evidence + dropdown selector — Design

**Date:** 2026-06-08 · **Status:** approved (verbal), pending spec review
**Builds on:** `2026-06-08-carrier-rate-cards-versioning-design.md` (time-versioned rate cards, already shipped to production).

## Goal

Make a rate card's source PDF the unit of creation and the permanent evidence trail:
upload a carrier rate-sheet PDF → parse it → review the parsed rates → confirm →
the system creates the dated card, writes its cells, and keeps the PDF as attached
proof. Replace the manual "create card" form and the chip-style card list with a
PDF-upload flow and a dropdown that marks which card is current vs history.

## Requirements (agreed with user)

1. **Cards are born from PDF upload** — remove the manual label+dates create form.
2. **Upload → parse → preview → confirm** (dry-run in the UI before any write); financial
   data is never written without human review.
3. **effectiveFrom auto-extracted** from the PDF (editable in the review step);
   **effectiveTo** set by the operator (or left open); overlapping windows are rejected.
4. **PDF stored in Cloudflare R2** via a reusable S3-compatible storage layer (the same
   layer will later serve product images).
5. **Each card links to its source PDF** as evidence (view/download).
6. **Card selector is a dropdown** showing each card's window and a **Current / History** badge.

## Non-goals (YAGNI)

- Multiple PDFs per card (one PDF per card; revisions = new card or re-upload overwrites the link).
- Auto-closing the previously-open card on upload (operator sets `effectiveTo` explicitly —
  this is what makes back-filling an older sheet, like FedEx 2025, work).
- Product-image upload (separate future feature; this only builds the shared storage layer).
- A DHL parser (out of scope; DHL uploads degrade gracefully to evidence-only — see §3).

## Architecture

The pure quote engine (`engine/quote.ts`), `loadAccountSnapshot`, and `reconcile.ts` are
**not touched** — they already read cells by `rate_card_id`. This feature only adds an
upload/parse/preview path in front of card creation, an R2 storage layer, and UI.

### 1. Storage layer (new, shared) — `lib/storage/r2.ts`

A thin S3-compatible client (`@aws-sdk/client-s3`) pointed at the R2 endpoint.

```ts
putObject(key: string, body: Uint8Array, contentType: string): Promise<void>
getObject(key: string): Promise<Uint8Array>
getSignedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>
```

- Config from env: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`.
  Endpoint = `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. Missing env → the storage
  functions throw a clear "R2 not configured" error (surfaced in the UI), so the rest of the
  app is unaffected until credentials are set.
- PDF object key: `rate-cards/<carrierAccountId>/<uuid>.pdf`. Product images will reuse the
  client under a different prefix (`product-images/…`) — no rework needed.
- Lives in `lib/` (shared), consistent with other cross-feature utilities the carrier-rates
  feature already imports (e.g. `lib/logging/audit`).

### 2. Schema — migration `0036`

Add three nullable columns to `carrier_rate_cards`:

- `source_pdf_key text` — R2 object key (NULL for the migrated card, which has no PDF).
- `source_pdf_filename text` — original upload filename, shown in the UI.
- `source_pdf_uploaded_at timestamp` — when the evidence was attached.

Nullable so the existing "Current (migrated)" cards remain valid. No new table (one PDF per card).

### 3. Server-side PDF parsing — `features/carrier-rates/import/parsers/`

- **Runtime:** add `poppler_utils` to `nixpacks.toml` so `pdftotext -layout` is on PATH in the
  Railway image. A server action shells out to it (`execFile`) and feeds the text to the
  existing, invoice-verified parser. This reuses `parseIpExport`/`toCells` unchanged
  (alternative pure-JS extraction was rejected — it risks the verified column parsing).
- **Parser registry:** `parsers/index.ts` maps a carrier key (+ optional format hint) to a
  parser module. Initial entry: FedEx International Priority (`fedex` → existing parser).
- **Effective-date extraction:** `extractEffectiveFrom(text): string | null` reads the sheet's
  "Net rates are effective as of DD Month YYYY" line → `YYYY-MM-DD`.
- **Graceful degradation:** if no parser matches the carrier, the upload still uploads the PDF
  and creates the card (evidence-only); the preview tells the operator to import rates via the
  existing CSV form. So DHL works today as evidence-only until a DHL parser is added.

### 4. Upload flow — `features/carrier-rates/rate-card-upload-actions.ts`

Two server actions (the middle step is UI state):

1. `stageRateCardPdf(carrierAccountId, file): Promise<StagedRateCard>`
   - Validate `file` is a PDF, ≤ ~10 MB.
   - Upload bytes to R2 at a key (this key becomes the card's evidence on commit).
   - Run `pdftotext -layout` → resolve parser by the account's carrier key → parse.
   - Return `{ pdfKey, filename, effectiveFromGuess, parserKey | null, preview }` where
     `preview` is the same self-check surface as the CLI dry-run: package/pak cell counts,
     zones covered, 9 ground-truth spot-checks, and the heavy per-kg table. If no parser:
     `preview` is null and a `note` explains evidence-only mode.

2. `commitRateCardFromPdf(input): Promise<{ id: string }>`
   - Input: `{ carrierAccountId, pdfKey, filename, effectiveFrom, effectiveTo | null }`.
   - **Re-parse server-side from the R2 object** (never trust client-sent cells — financial data).
   - Validate dates (`YYYY-MM-DD`, `to ≥ from`) and no-overlap via existing `windowsOverlap`.
   - Insert the card with `source_pdf_key`/`source_pdf_filename`/`source_pdf_uploaded_at`,
     then upsert all cells (Package + Pak, same convention as the CLI importer).
   - For evidence-only (no parser): create the card with the PDF link, write no cells.
   - `revalidatePath` the matrix page.

### 5. UI — `app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx` + components

- **Dropdown selector** (shadcn `Select`) replaces the chip `<Link>` row. Each option:
  `{label} · {from} → {to|open}` with a trailing badge **Current** (`effectiveTo IS NULL`) or
  **History**. Changing selection navigates to `?card=<id>` (server-rendered, as today).
- **Upload PDF** card replaces `CreateCardForm`: `<input type="file" accept="application/pdf">`
  → calls `stageRateCardPdf` → renders the preview + an editable `effectiveFrom` (prefilled)
  and `effectiveTo` input + **"Create card & import"** → `commitRateCardFromPdf`.
- **Evidence link:** the selected card shows "View source PDF" when `source_pdf_key` is set,
  linking to a route that streams the file from R2.
- The existing **Bulk import CSV** card stays (fallback for evidence-only carriers).

### 6. Evidence route — `app/(dashboard)/f/carrier-rates/[id]/cards/[cardId]/pdf/route.ts`

Auth-gated GET (same `view_carrier_rates` permission as the page). Looks up the card's
`source_pdf_key` and 307-redirects to a short-lived R2 signed download URL (≤ 5 min). 404 if
the card has no PDF, 403 if the caller lacks permission. (Redirect, not byte-streaming, so the
file is served directly by R2/CDN.)

## Data flow (happy path, FedEx)

```
operator picks FedEx-2025.pdf
  → stageRateCardPdf: R2.putObject(key, bytes); pdftotext; parseIpExport; toCells
      → preview { package:1298, pak:110, zones:22/22, spotchecks ✓, heavy table },
        effectiveFromGuess: "2025-10-28"
  → operator confirms from=2025-10-28, sets to=2026-01-04, clicks Create
  → commitRateCardFromPdf: re-parse from R2 object; windowsOverlap ok;
      insert card(source_pdf_key=…); upsert 1408 cells
  → dropdown now lists "FedEx IP 2025 · 2025-10-28 → 2026-01-04 [History]" with View-source-PDF
```

## Error handling

- R2 not configured / upload fails → action throws "Storage not configured" / network error,
  shown in the UI; no card created.
- PDF not parseable / wrong format → preview reports `0 cells` and the self-check fails;
  commit is blocked (button disabled) — operator can still create evidence-only if intended.
- Overlapping window → `windowsOverlap` rejects at commit with the existing message.
- Self-check mismatch (counts/spot-checks) at commit → throw before writing any cell (the
  commit re-runs the same assertions the CLI uses).

## Testing

- `lib/storage/r2`: unit-test with a mocked S3 client — asserts `putObject`/`getSignedDownloadUrl`
  build the right bucket/key/params; asserts the "not configured" error path.
- `extractEffectiveFrom`: table-test the date-line formats (`28 October 2025` → `2025-10-28`,
  missing line → null).
- Parser registry: resolves `fedex` → parser; unknown carrier → null.
- `parseIpExport`/`toCells`: existing 10 tests cover the parse + cell mapping.
- `windowsOverlap`: existing tests; add a back-fill case (older window slots before an open card).
- commit validation is exercised via the re-parse self-check (same assertions as the CLI dry-run).

## Build order (for the plan)

1. `lib/storage/r2.ts` + tests (+ `@aws-sdk/client-s3` dep, env wiring).
2. Migration `0036` (source_pdf_* columns) + schema.
3. `nixpacks.toml` poppler_utils; parser registry + `extractEffectiveFrom` + tests.
4. `rate-card-upload-actions.ts` (`stageRateCardPdf`, `commitRateCardFromPdf`).
5. Matrix UI: dropdown selector (Current/History).
6. Matrix UI: PDF upload + preview/confirm; evidence route.
7. Manual verification on staging, then production (with R2 creds set).

## Open items the operator must provide

- Cloudflare R2 bucket + API token → set `R2_*` env vars on Railway (and locally for staging).
