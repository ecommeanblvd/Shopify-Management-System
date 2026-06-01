'use server';

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/**
 * Seed the FedEx Demand Surcharge table for export shipments FROM
 * Vietnam, as published at
 *   https://www.fedex.com/en-vn/shipping/surcharges/demand-surcharge.html
 *
 * The published page is geofenced + bot-blocked so we mirror the values
 * the operator screenshotted (2026-06). Each row sets:
 *   - kind = 'demand_per_kg'
 *   - value in VND/kg (already in the carrier account's cost currency)
 *   - country_codes = ISO-2 list for the region group
 *   - note = the FedEx region label, so the operator can match against
 *     the published table at a glance
 *
 * Rows with value=0 in the screenshot (Australia/NZ, Asia, India) are
 * deliberately NOT inserted — the engine multiplies by weight, so a 0-VND
 * row is a no-op and just clutters the section.
 *
 * Multi-country regions (Europe², MEISA³, LAC⁴) use FedEx's standard
 * country groupings. Footnote details vary slightly by published edition;
 * the operator can edit any row via the existing surcharge dialog if a
 * country needs to be added or removed.
 *
 * This is intentionally idempotent — running it twice on the same FedEx
 * account skips rows whose (kind, value, countryCodes) already exist, so
 * the operator can re-trigger after a partial seed without dupes.
 */

interface SeedRow {
  /** VND per kg. */
  value: number;
  /** ISO-2 country codes the row applies to. */
  countryCodes: string[];
  /** FedEx-published region label — shown as the row's note. */
  note: string;
}

const SEED_ROWS: SeedRow[] = [
  {
    value: 11_300,
    countryCodes: ['US', 'PR'],
    note: 'United States of America (USA) and Puerto Rico',
  },
  {
    value: 11_300,
    countryCodes: ['CA'],
    note: 'Canada',
  },
  {
    value: 11_300,
    countryCodes: ['MX'],
    note: 'Mexico',
  },
  {
    value: 28_400,
    countryCodes: ['IL'],
    note: 'Israel',
  },
  {
    // FedEx Europe² grouping — EU + EFTA + UK + the rest of geographic
    // Europe. Reflects the standard FedEx Europe service area. Trim if
    // a country needs different handling.
    value: 28_400,
    countryCodes: [
      // EU-27 + UK
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
      'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT',
      'RO', 'SK', 'SI', 'ES', 'SE', 'GB',
      // EFTA + microstates
      'CH', 'NO', 'IS', 'LI', 'AD', 'MC', 'SM', 'VA',
      // Balkans + Eastern Europe
      'AL', 'BA', 'XK', 'MK', 'ME', 'RS', 'MD', 'UA', 'BY',
      // Russia + Türkiye
      'RU', 'TR',
      // Gibraltar
      'GI',
    ],
    note: 'Europe²',
  },
  {
    // FedEx MEISA³ = Middle East + Indian Subcontinent (excluding India,
    // which is its own row at 0 VND/kg) + Africa. ~64 codes.
    value: 39_700,
    countryCodes: [
      // Middle East
      'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'IQ', 'JO', 'LB', 'SY', 'YE', 'IR',
      // Indian Subcontinent (India excluded — separate row)
      'PK', 'BD', 'LK', 'NP', 'BT', 'MV', 'AF',
      // Africa (all internationally recognised)
      'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM',
      'CG', 'CD', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH',
      'GN', 'GW', 'CI', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR',
      'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL',
      'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW',
    ],
    note: 'Middle East/Indian Subcontinent/Africa (MEISA)³',
  },
  {
    // FedEx LAC⁴ = Latin America + Caribbean, excluding Mexico (own row)
    // and Puerto Rico (in the USA row). All other Central + South American
    // and Caribbean nations.
    value: 11_300,
    countryCodes: [
      // Central + South America
      'AR', 'BZ', 'BO', 'BR', 'CL', 'CO', 'CR', 'EC', 'SV', 'FK', 'GF',
      'GT', 'GY', 'HN', 'NI', 'PA', 'PY', 'PE', 'SR', 'UY', 'VE',
      // Caribbean
      'AI', 'AG', 'AW', 'BS', 'BB', 'BM', 'BQ', 'KY', 'CU', 'CW', 'DM',
      'DO', 'GD', 'GP', 'HT', 'JM', 'MQ', 'MS', 'KN', 'LC', 'MF', 'VC',
      'SX', 'TT', 'TC', 'VG', 'VI',
    ],
    note: 'Latin America (LAC)⁴',
  },
];

export interface SeedResult {
  inserted: number;
  skipped: number;
  /** Notes of the rows that already existed and were skipped. */
  skippedNotes: string[];
}

/**
 * Insert the FedEx Vietnam Demand Surcharge rows into the given carrier
 * account. Rows already present (same kind + value + country list) are
 * skipped so the operator can re-run safely after editing some rows.
 *
 * No permission check inside — the caller (a server action on a page
 * gated by `manage_carrier_rates`) owns the auth check.
 */
export async function seedFedexVietnamDemand(
  carrierAccountId: string, userId: string,
): Promise<SeedResult> {
  // Pull existing demand_per_kg rows once so we can dedupe in JS rather
  // than firing a SELECT per candidate.
  const existing = await db
    .select({
      value: schema.carrierSurcharges.value,
      countryCodes: schema.carrierSurcharges.countryCodes,
    })
    .from(schema.carrierSurcharges)
    .where(and(
      eq(schema.carrierSurcharges.carrierAccountId, carrierAccountId),
      eq(schema.carrierSurcharges.kind, 'demand_per_kg'),
    ));
  const existingKeys = new Set(
    existing.map((r) => keyOf(Number(r.value), (r.countryCodes as string[] | null) ?? [])),
  );

  let inserted = 0;
  const skippedNotes: string[] = [];
  for (const row of SEED_ROWS) {
    if (existingKeys.has(keyOf(row.value, row.countryCodes))) {
      skippedNotes.push(row.note);
      continue;
    }
    await db.insert(schema.carrierSurcharges).values({
      carrierAccountId,
      kind: 'demand_per_kg',
      value: row.value.toString(),
      countryCodes: row.countryCodes,
      note: row.note,
      updatedBy: userId,
    });
    inserted += 1;
  }

  return { inserted, skipped: skippedNotes.length, skippedNotes };
}

function keyOf(value: number, countryCodes: string[]): string {
  return `${value}|${[...countryCodes].sort().join(',')}`;
}
