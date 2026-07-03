/** Nguồn sự thật: trường địa chỉ bắt buộc theo quốc gia (ship hộ). Thuần, không phụ thuộc React/DB. */

export interface AddressExtraReq {
  houseNumber?: true; // house number bắt buộc
  shortAddressOrMaps?: true; // cần short address HOẶC maps url
}

// SA: short-address-hoặc-maps. AE/QA/KW/BH/OM: house number. Khác: không yêu cầu.
export const ADDRESS_EXTRA: Record<string, AddressExtraReq> = {
  SA: { shortAddressOrMaps: true },
  AE: { houseNumber: true },
  QA: { houseNumber: true },
  KW: { houseNumber: true },
  BH: { houseNumber: true },
  OM: { houseNumber: true },
};

export interface AddressExtraInput {
  houseNumber?: string;
  shortAddress?: string;
  mapsUrl?: string;
}

const SHORT_ADDRESS_RE = /^[A-Z]{4}[0-9]{4}$/;

export function requirementFor(country: string): AddressExtraReq | undefined {
  return ADDRESS_EXTRA[country.trim().toUpperCase()];
}

function isHttpUrl(s: string): boolean {
  let u: URL;
  try { u = new URL(s); } catch { return false; }
  return u.protocol === 'http:' || u.protocol === 'https:';
}

export function validateAddressExtra(
  country: string,
  input: AddressExtraInput,
): { ok: boolean; error?: string; normalized: AddressExtraInput } {
  const req = requirementFor(country);
  if (!req) return { ok: true, normalized: {} };

  const normalized: AddressExtraInput = {};

  if (req.houseNumber) {
    const hn = (input.houseNumber ?? '').trim();
    if (!hn) return { ok: false, error: 'Thiếu House Number', normalized };
    normalized.houseNumber = hn;
  }

  if (req.shortAddressOrMaps) {
    const short = (input.shortAddress ?? '').trim().toUpperCase();
    const maps = (input.mapsUrl ?? '').trim();
    if (short) {
      if (!SHORT_ADDRESS_RE.test(short)) {
        return { ok: false, error: 'Short Address phải là 4 chữ + 4 số (vd RBMA4176)', normalized };
      }
      normalized.shortAddress = short;
    }
    if (maps) {
      if (!isHttpUrl(maps)) {
        return { ok: false, error: 'Google Maps link phải là URL http(s) hợp lệ', normalized };
      }
      normalized.mapsUrl = maps;
    }
    if (!normalized.shortAddress && !normalized.mapsUrl) {
      return { ok: false, error: 'Cần ít nhất 1: Short Address hoặc Google Maps link', normalized };
    }
  }

  return { ok: true, normalized };
}
