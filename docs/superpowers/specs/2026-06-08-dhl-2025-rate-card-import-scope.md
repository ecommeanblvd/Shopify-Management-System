# DHL 2025 Rate Card Import — Scope & Handoff

**Date:** 2026-06-08
**Status:** Scoped, NOT started (handoff to fresh session — prior session hit cost ceiling)
**Source PDF:** `/Users/macos/Downloads/Bảng giá DHL 2025.pdf` (DHL Express Vietnam, Customer 527888723-2025)

---

## Decisions locked (from user)

- **Effective date:** `2025-01-01`, open-ended (`effectiveTo = null`). Footer: "Ratecard as of: 01-Jan-2025"; GPI effective Jan 1 each year; version TimeStamp 04-Nov-2024.
- **Scope (first increment):** ONLY the **WORLDWIDE EXPORT** grid, sub-table **"Non-documents from 0.5 KG & Documents from 2.5 KG"**. (Ignore for now: Export-Documents≤2kg, Import-Documents≤2kg, Import-Non-doc.)
- **Approach:** Write a **DHL parser** that reuses the existing PDF-upload flow (like FedEx), NOT a one-off script.

---

## PDF structure (4 pages)

- **Page 1 — WORLDWIDE EXPORT** (our target). Two stacked tables:
  - "Documents up to 2.0 KG" (out of scope)
  - "Non-documents from 0.5 KG & Documents from 2.5 KG" (**IN SCOPE**)
  - Columns: KG, Zone 1 … Zone 10. Rows: 0.5, 1.0, 1.5, 2.0, 2.5, 3.0 … 30.0 (0.5 steps).
  - Below: **"Multiplier rate per 1 KG from 30.1 KG"** — bands: 30.1–70, 70.1–300, 300.1–99,999, each with a per-kg rate per zone.
  - Premium add-ons (per shipment, all zones): Premium 9:00 +900,000 VND; 10:30 +750,000; 12:00 +450,000.
  - Currency: **VND**, excl. taxes/fuel/surcharges.
- **Page 2 — WORLDWIDE IMPORT** (same shape; out of scope for first increment).
- **Page 3 — ZONING** (Export & Import use the SAME zoning): country (ISO-2) → Zone (1–10). ~230 rows. Note special China rows: CN*1 (SZX/FOC/HAK/SWA/ZUH/CAN/DGM/XMN/CGO) = Zone 2; CN*2 (Rest of China) = Zone 5. Hong Kong (HK) = Zone 1, Macau (MO)=3, Singapore(SG)=1, Thailand(TH)=1, Malaysia(MY)=1, Vietnam domestic not listed (it's the origin).
- **Page 4 — Services & surcharges:** GOGREEN PLUS carbon-reduced = 3,800 VND rate/kg (but "Your charges are waived"); Volumetric divisor = 5,000.

### Spot-check values (Export · Non-doc table, for parser TDD)
- 0.5 kg: Zone1 379,535 · Zone2 381,588 · Zone3 404,916 · Zone5 508,216 · Zone10 968,398
- 2.5 kg: Zone1 710,476 · Zone2 745,702 · Zone10 1,889,704
- 30.0 kg: Zone1 2,562,701 · Zone2 2,775,482 · Zone10 10,428,344
- Multiplier 30.1–70: Zone1 106,793/kg · Zone10 450,861/kg
- Multiplier 70.1–300: Zone1 148,893/kg · Zone10 617,551/kg
- Multiplier 300.1–99,999: Zone1 154,611/kg · Zone10 678,373/kg

---

## Existing pipeline (must integrate with) — all FedEx-shaped, watch out

- `features/carrier-rates/import/pdf-text.ts` → `extractPdfText(bytes)` uses `pdftotext -layout`. **Re-run on the DHL PDF first to see actual column text** before writing the parser.
- `features/carrier-rates/import/parsers/types.ts` → `RateSheetParser` interface is FedEx-shaped: `parse(text): ParsedIpExport`, `expectedPackageCells`, `expectedPakCells`, `spotChecks` with `packageType: 'package'|'pak'`.
- `features/carrier-rates/import/fedex-2025-rates.ts` → `ParsedIpExport`, `PackageType`, `toCells(parsed, tierUppers): RateCellInput[]` (RateCellInput has `packageType`), `parseIpExport`.
- `features/carrier-rates/import/preview.ts` → `buildRateCardCells(parser, text, tierUppers, zoneLabels)` validates cell counts, zone/tier membership, spot-checks.
- `features/carrier-rates/import/parsers/index.ts` → `resolveParser(carrierKey)`, `PARSERS = [fedexIpParser]`. **Register the DHL parser here.**
- `features/carrier-rates/rate-card-upload-actions.ts` → `stageRateCardPdf` / `commitRateCardFromPdf`. Maps parsed cells into **EXISTING** zones (by label) + EXISTING tiers. Does NOT create zones/tiers/countries.

### DHL ↔ FedEx shape mismatch
DHL Export Non-doc is a **single grid** (no package/pak split). Simplest fit: emit all cells as `packageType: 'package'`, `expectedPakCells: 0`. The multiplier bands (≥30.1kg per-kg) match the FedEx "HeavyBand" concept (`toCells` already multiplies per-kg × tier upper). Reuse that pattern. Decide whether to reuse `ParsedIpExport` directly or generalize the interface (prefer reuse to keep scope small).

---

## Prerequisites that DON'T exist yet (the "open dependency")

The upload flow maps cost into pre-existing zones/tiers. So before/with the parser we must seed:

1. **DHL carrier + carrier account** with `carriers.key` matching the parser's `carrierKey` (check if a DHL carrier row exists; FedEx uses key `'fedex'` → DHL likely `'dhl'`). Account currency VND, weight unit kg.
2. **Zones "Zone 1" … "Zone 10"** for that account (labels must match what the parser emits).
3. **Weight tiers**: 0.5,1.0,…,30.0 (0.5 steps) PLUS multiplier breakpoints 70, 300, 99999 (FedEx handles these as heavy bands — mirror exactly).
4. **Country→zone mapping** from page 3 (~230 ISO-2 codes), including the CN*1/CN*2 split (model as the listed sub-regions if supported, else map CN to one zone + note).

Seeding can be a script (`scripts/import-dhl-2025.ts`, mirror `scripts/import-fedex-2025.ts`) OR baked into the commit flow. Reference `scripts/import-fedex-2025.ts` + `scripts/lib/fedex-2025-rates.ts` for the established pattern.

---

## Suggested task order (TDD, fresh session)

1. Re-extract DHL PDF text (`pdftotext -layout`) → inspect column layout.
2. TDD: pure `parseDhlExport(text)` returning zone×tier costs + multiplier bands (spot-checks above).
3. TDD: `toCells`/adapter producing `RateCellInput[]` (packageType 'package', pak=0).
4. Wrap as `dhlExpressParser: RateSheetParser`; register in `parsers/index.ts`.
5. Seed script: DHL carrier account + Zones 1-10 + tiers + country map (page 3).
6. Run upload/commit for the PDF with effectiveFrom=2025-01-01; verify cells via `/f/carrier-rates/<id>/workspace`.
7. Tests green, typecheck, lint, build. Commit per step.

---

## Verify-first notes for next session
- Confirm whether a DHL carrier/account already exists (`db` carriers/carrierAccounts) before creating duplicates.
- The workspace page built earlier (`/f/carrier-rates/[id]/workspace`) is the read-only viewer to confirm the import landed.
