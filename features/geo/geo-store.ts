import { gunzipSync } from 'node:zlib';
import { getObject } from '@/lib/storage/s3';

/** Nội dung 1 file từ điển geo/nước, giải nén từ geo-dict/<CC>.json.gz. */
export interface GeoCountryFile {
  cities: Array<{ name: string; stateCode: string | null }>;
  // postcodeNorm → danh sách city ứng viên (giữ thứ tự city asc như query cũ)
  postcodes: Record<string, Array<{ city: string; stateCode: string | null }>>;
}

export interface GeoStoreDeps {
  fetchFile: (cc: string) => Promise<Buffer | null>; // null = file không tồn tại
}

/** Đọc raw bytes (đã gzip) từ Supabase Storage; lỗi bất kỳ (not-found/network) → null, không throw. */
async function fetchFileFromStorage(cc: string): Promise<Buffer | null> {
  try {
    const bytes = await getObject(`geo-dict/${cc.toUpperCase()}.json.gz`);
    return Buffer.from(bytes);
  } catch (err) {
    // NoSuchKey/404 (nước chưa có từ điển) hoặc lỗi mạng — degrade an toàn, không chặn form nhập đơn (D-008).
    console.warn(`[geo-store] Không đọc được geo-dict cho "${cc}", bỏ qua:`, err);
    return null;
  }
}

/**
 * Tạo geo store đọc từ điển geo theo nước, cache module-level.
 * Cache theo Promise (không phải giá trị đã resolve) để 2 lệnh gọi song song
 * cho cùng 1 nước chỉ trigger đúng 1 lần fetchFile — tránh double-fetch.
 */
export function createGeoStore(deps: GeoStoreDeps) {
  const cache = new Map<string, Promise<GeoCountryFile | null>>();

  function load(cc: string): Promise<GeoCountryFile | null> {
    const key = cc.toUpperCase();
    const cached = cache.get(key);
    if (cached) return cached;

    const promise = (async (): Promise<GeoCountryFile | null> => {
      const raw = await deps.fetchFile(key);
      if (!raw) return null;
      const json = gunzipSync(raw).toString('utf-8');
      return JSON.parse(json) as GeoCountryFile;
    })();
    cache.set(key, promise);
    return promise;
  }

  return {
    async getCities(cc: string, state?: string): Promise<string[] | null> {
      const file = await load(cc);
      if (!file) return null;
      const rows = state ? file.cities.filter((c) => c.stateCode === state) : file.cities;
      return rows.map((c) => c.name).sort((a, b) => a.localeCompare(b));
    },

    async getPostcode(cc: string, norm: string): Promise<Array<{ city: string; stateCode: string | null }> | null> {
      const file = await load(cc);
      if (!file) return null;
      return file.postcodes[norm] ?? [];
    },

    async getPostcodeSet(cc: string): Promise<Set<string> | null> {
      const file = await load(cc);
      if (!file) return null;
      return new Set(Object.keys(file.postcodes));
    },

    invalidate(cc?: string): void {
      if (cc) cache.delete(cc.toUpperCase());
      else cache.clear();
    },
  };
}

/** Instance mặc định dùng Supabase Storage — dùng trong app. */
export const geoStore: ReturnType<typeof createGeoStore> = createGeoStore({ fetchFile: fetchFileFromStorage });
