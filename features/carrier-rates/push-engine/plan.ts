/**
 * Logic thuần cho "Push Carrier Rates": dựng participant (carrier nào hiện) +
 * dòng Standard shipping backup từ matrix. Không I/O — test được.
 */

/** Tên hiển thị ở checkout (khớp service_name callback trả về). */
export const ENGINE_DISPLAY: Record<string, string> = {
  fedex: 'FedEx International Priority',
  dhl: 'DHL Express',
};

export interface ParticipantInput {
  carrierServiceId: string;
  adaptToNewServices: boolean;
  participantServices: { name: string; active: boolean }[];
}

/**
 * Participant chỉ bật ĐÚNG các carrier được chọn. `adaptToNewServices=false` để
 * Shopify KHÔNG tự thêm carrier khác (vd pause DHL → chỉ FedEx hiện dù callback
 * vẫn trả cả 2).
 */
export function buildParticipant(carrierServiceId: string, carriers: string[]): ParticipantInput {
  const participantServices = carriers
    .filter((c) => ENGINE_DISPLAY[c])
    .map((c) => ({ name: ENGINE_DISPLAY[c], active: true }));
  return { carrierServiceId, adaptToNewServices: false, participantServices };
}

export interface ZoneCountry { countryCode?: string | null; restOfWorld?: boolean | null }
/** Zone nội địa VN (free) → KHÔNG đụng. */
export function isVnZone(countries: ZoneCountry[]): boolean {
  return countries.length === 1 && countries[0]?.countryCode === 'VN' && !countries[0]?.restOfWorld;
}

function band(label: string): { lo: number; up: number } | null {
  const m = label.match(/\(\s*([\d.]+)\s*[–-]\s*([\d.]+)\s*kg/i);
  return m ? { lo: Number(m[1]), up: Number(m[2]) } : null;
}

function weightConds(lo: number, up: number) {
  const c: Array<{ criteria: { value: number; unit: string }; operator: string }> = [];
  if (lo > 0) c.push({ criteria: { value: lo, unit: 'KILOGRAMS' }, operator: 'GREATER_THAN_OR_EQUAL_TO' });
  c.push({ criteria: { value: up, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' });
  return c;
}

export interface RateInput { price: number; currency: string }
/**
 * Dòng "Standard shipping" (flat backup) từ rates FedEx của matrix zone. Tên gọn
 * "Standard shipping" (không kèm bậc cân — khách không cần biết), gate theo cân.
 */
export function standardBackupDefs(rates: Record<string, RateInput>) {
  return Object.entries(rates)
    .filter(([label]) => /fedex/i.test(label))
    .map(([label, r]) => {
      const b = band(label);
      if (!b) return null;
      return {
        name: 'Standard shipping',
        active: true,
        rateDefinition: { price: { amount: String(r.price), currencyCode: r.currency || 'USD' } },
        weightConditionsToCreate: weightConds(b.lo, b.up),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
