import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { CITIES_BY_ISO } from '@/lib/geo/cities';
import { geoStore } from './geo-store';
import { normPostcode } from './geonames-parse';
import { pickLookupResult, type GeoLookupResult } from './lookup-logic';

export async function isCountryImported(cc: string): Promise<boolean> {
  const [r] = await db.select({ id: schema.geoImports.id }).from(schema.geoImports)
    .where(eq(schema.geoImports.countryCode, cc)).limit(1);
  return !!r;
}

export async function listStates(cc: string): Promise<Array<{ code: string; name: string }>> {
  return db.select({ code: schema.geoStates.code, name: schema.geoStates.name })
    .from(schema.geoStates).where(eq(schema.geoStates.countryCode, cc)).orderBy(asc(schema.geoStates.name));
}

/** Storage (geo-store) khi đã import; fallback curated static khi chưa (không vỡ MMP hiện tại). */
export async function listCities(cc: string, state?: string): Promise<string[]> {
  if (!(await isCountryImported(cc))) return CITIES_BY_ISO[cc] ?? [];
  const cities = await geoStore.getCities(cc, state);
  if (cities === null) {
    // DB nói đã imported nhưng file Storage thiếu — bất nhất; fallback + cảnh báo.
    console.warn(`[geo/queries] listCities("${cc}"): DB imported nhưng geo-store trả null — fallback CITIES_BY_ISO`);
    return CITIES_BY_ISO[cc] ?? [];
  }
  return cities;
}

export type GeoLookupResultNullable = Omit<GeoLookupResult, 'valid'> & { valid: boolean | null };

/** valid=null nghĩa "nước chưa nạp — không biết" (form không chặn). */
export async function lookupPostcode(cc: string, code: string): Promise<GeoLookupResultNullable> {
  if (!(await isCountryImported(cc))) return { valid: null, city: null, stateCode: null, candidates: [] };
  const rows = await geoStore.getPostcode(cc, normPostcode(code));
  if (rows === null) return { valid: null, city: null, stateCode: null, candidates: [] };
  return pickLookupResult(rows);
}
