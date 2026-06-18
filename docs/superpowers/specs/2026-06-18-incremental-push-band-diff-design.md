# Incremental Push — Band-Aware In-Place Rate Update (Design)

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan

## Goal

Make "Push to Shopify" (Manual Shipping rates) **apply price changes in place** when the
store's zone structure already matches the system, instead of always deleting all zones
and recreating them. Delete/recreate happens **only** for a new store or genuine zone
drift. This removes the slow mass delete+create on the common case (global price change
such as a markup or fuel-band update).

## Background / Why this is non-trivial

- Current push (`pushShippingStep`) uses **clean-rebuild** (`buildCleanRebuildVariables`):
  every push deletes all system zones and recreates them. Slow and heavy.
- The codebase already has a diff builder (`buildProfileUpdateVariables` /
  `denormalizeToMutationInput`) that updates rates in place — but it **cannot** be used
  for the system manual rates as-is, because:
  - On push, system rate names are normalized: `FedEx IP (0–0.5 kg)`,
    `FedEx IP (0.5–1 kg)`, … all collapse to a **single Shopify name** `Standard shipping`
    (DHL → `Express shipping`), distinguished only by **weight condition**
    (`normalizeRateForShopify` + `RATE_NAME_MAP`).
  - The profile read (`normalizeProfileNode`) keys rates by **name** only
    (`rateIdByZoneAndName["<zone>.<name>"]`), so multiple bands collide — band identity is
    lost — and the read query does **not** fetch weight conditions at all.
  - A naive diff therefore treats `FedEx IP (...)` as a new rate and creates duplicates.

This is why clean-rebuild was originally chosen. The fix is to make matching **band-aware**.

## Architecture

Push decides **per zone** (the natural output of a diff):

| Store vs system | Action |
| --- | --- |
| Zone matches (same countries + same band set) | `methodDefinitionsToUpdate` for bands whose price changed; identical price → skipped (no op) |
| Zone exists, band missing on store | `methodDefinitionsToCreate` in that zone |
| Zone exists, band present on store but not in system | `methodDefinitionsToDelete` |
| Zone missing on store | `zonesToCreate` (full zone) |
| Zone exists but country set drifted | delete that zone + recreate it |

The engine phase (attach carrier-service participant) is unchanged and runs after.

Result: a global price change (markup/fuel) becomes a series of price updates only — no
zone deletes.

## Components / Changes

### 1. Read — extend `SHIPPING_QUERY`
Fetch each method definition's weight conditions in addition to `name` + `rateProvider.price`.
Shopify exposes these on `DeliveryMethodDefinition.methodConditions` (field `WEIGHT`,
`operator`, and a weight `conditionCriteria { value unit }`). The exact field selection is
verified against the live schema during implementation.

### 2. Normalize — band-aware identity
In `normalizeProfileNode`, in addition to the existing (unchanged) `rateIdByZoneAndName`,
build a **new** structure keyed by `(zoneName, mappedName, upperBand)`:

- `mappedName` = the Shopify rate name as stored (`Standard shipping` / `Express shipping`).
- `upperBand` = the upper bound (kg) parsed from the method def's weight condition
  (`LESS_THAN_OR_EQUAL_TO` value), rounded to a stable precision. The **upper** bound is
  used as the band key because it is exact and unique within a `(zone, mappedName)` group;
  the lower bound is skipped to avoid the `BAND_LOWER_OFFSET_KG = 0.01` offset.
- Key shape: e.g. `"NA2.Standard shipping.0.5"` → method definition id.
- A method def with no weight condition (single flat rate) keys under a sentinel upper
  (e.g. `"∞"` / `null`), so flat rates still match.

The existing `rateIdByZoneAndName` and `ShippingTree`-by-name stay intact so other push
paths (settings-sync diff) are unaffected.

### 3. New diff builder `buildSystemUpdateVariables(current, systemTree, locationGroupId)`
Returns `{ id, profile }` for `deliveryProfileUpdate`, plus a small **report** the caller
uses to decide the path: `{ zonesToCreate, zonesToDelete, rateUpdates, rateCreates,
rateDeletes }` counts.

For each system zone (e.g. `NA2`) and each system rate `FedEx IP (a–b kg)`:
- Compute `mappedName` (`Standard shipping`/`Express shipping`) + `upperBand` = `b`.
- Look up existing method-def id by `(zoneName, mappedName, b)`:
  - exists + price differs → `methodDefinitionsToUpdate { id, rateDefinition.price }`
  - exists + price equal → skip
  - missing band (zone exists) → `methodDefinitionsToCreate`
  - zone missing → `zonesToCreate` (full, like clean-rebuild's zone build)
- Bands present on store under `(zone, mappedName)` but absent in system → `methodDefinitionsToDelete`.
- Country drift: if an existing zone's country set ≠ system zone's country set →
  push that zone id to `zonesToDelete` and add the system zone to `zonesToCreate`.
- Apply the same `SHOPIFY_UNSUPPORTED_COUNTRIES` filtering used by clean-rebuild.

### 4. `pushShippingStep` — new `manual-update` phase
- At cursor init (`cursor === null`) for a manual push: read the profile (band-aware),
  run `buildSystemUpdateVariables`.
- If the report is **update-only** (no `zonesToCreate`, no `zonesToDelete`) → enter a new
  `manual-update` phase that sends the update mutation **chunked** (~40 rate updates per
  mutation, reusing `send()` retry), then transitions to the `engine` phase.
- Otherwise (new store / drift) → enter the existing `manual-delete` → `manual-create`
  clean-rebuild phases unchanged.
- Snapshot backup is still written before any write, exactly as today.

New cursor variant:
`{ phase: 'manual-update'; updateStart: number }` (index into the chunked update list).

## Error handling / safety
- The update path performs **no mass delete**, so there is no window where the store has
  lost all zones mid-failure — strictly safer than clean-rebuild.
- Reuse `send()` / `read()` retry wrappers and the hardened `graphqlCall` (clear errors on
  non-JSON, matchable by the `TRANSIENT` regex).
- Band offset (`0.01`) cannot cause mismatches because matching keys on the rounded upper
  bound only.
- If band-aware parsing yields an ambiguous/empty mapping for a zone (unexpected store
  shape), that zone is treated as **drifted** → falls back to delete+recreate for that
  zone (fail safe, never silently skip).

## Testing
Unit tests (vitest), no network:
1. `parseWeightConditionUpper` — reads Shopify weight conditions back to an upper band
   (incl. the `+0.01` lower offset present, single flat rate with no condition).
2. Band-aware normalize — a profile node with multiple `Standard shipping` bands yields
   distinct `(zone, name, upper)` keys (no collision).
3. `buildSystemUpdateVariables`:
   - price-only change across all zones → only `methodDefinitionsToUpdate`, zero create/delete.
   - identical prices → empty (no-op).
   - new zone → `zonesToCreate`.
   - band added / removed → create / delete of that band only.
   - country drift on an existing zone → that zone in `zonesToDelete` + `zonesToCreate`.
4. Path decision — update-only report → `manual-update`; any zone create/delete → clean-rebuild.

## Out of scope
- No change to the engine (carrier-service participant) phase.
- No change to the system price generator or pricing logic.
- No change to other push paths (settings-sync `buildProfileUpdateVariables`).
