# Carrier-rates Matrix page — redesign requirements (accumulated, not yet built)

**Page:** `app/(dashboard)/f/carrier-rates/[id]/matrix/page.tsx` (+ `components/carrier-rates/RateMatrix.tsx`, `RateCardSelect.tsx`, `RateCardUpload.tsx`).
**Branch base:** `main` (PDF feature already merged via #139, deployed).

User-requested changes to build together in one clean redesign:

1. **Upload → header button.** Move "Upload & preview" out of the Rate-cards card into a
   button at the **far right of the title row** ("Cost per (zone × tier)"). Clicking opens the
   upload + preview/confirm flow (e.g. a modal/drawer instead of inline).

2. **Rate-card dropdown → search row.** Move the `RateCardSelect` dropdown down so it sits on
   the **same row as the matrix amount-search** (the "Tìm theo số tiền VND" box, currently
   inside `RateMatrix`). Make a single toolbar row: [card dropdown] … [search].

3. **BUG — dropdown shows raw id.** The Select trigger currently renders the selected card's
   **id** (`37d3b39a-…`) instead of its label ("FedEx IP 2026"). `<SelectValue>` isn't
   reflecting the item text — fix so the friendly `label · from → to · Current/History` shows.

4. **Merge Zones into this page.** Bring Zones together with the matrix so search covers both
   and a PDF import (which carries both) lands in one place.
   **OPEN DECISION (user not yet answered):** full merge (move zone+country editing here, retire
   `/zones`) vs. lighter (add a searchable Zones panel here, keep `/zones` for heavy editing).

5. **Pak + Package both shown.** Rate Matrix must show **two stacked tables — Pak on top,
   Package below** — for cross-checking numbers. Currently only Package renders (`loadMatrix`
   returns cells without distinguishing `package_type`; `RateMatrix` shows one value per cell).
   Pak only has tiers 0.5–2.5 kg (small table); Package has all 59 tiers.

6. **Search across both.** The amount/zone search should highlight matches in **both** the zones
   list and the matrix cells.

## Notes for implementation
- `loadMatrix` (matrix-actions.ts) must return cells split by `package_type` (currently merges).
- Search lives inside `RateMatrix` (`<MatrixSearch>`); moving the dropdown beside it means
  lifting a shared toolbar or passing the selector into RateMatrix.
- Do this as one brainstorm → spec → plan → build pass (touches the same files repeatedly).
