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

/** True khi lỗi từ AWS SDK là "không tồn tại" thật sự (không phải lỗi mạng/tạm thời). */
function isNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'NoSuchKey' || e.Code === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404;
}

/**
 * Đọc raw bytes (đã gzip) từ Supabase Storage.
 * Not-found thật (NoSuchKey/404) → null (đây là trạng thái hợp lệ: nước chưa có từ điển).
 * Lỗi khác (network/timeout/5xx…) → ném lại để load() KHÔNG cache kết quả này — lần gọi sau retry.
 */
async function fetchFileFromStorage(cc: string): Promise<Buffer | null> {
  try {
    const bytes = await getObject(`geo-dict/${cc.toUpperCase()}.json.gz`);
    return Buffer.from(bytes);
  } catch (err) {
    if (isNotFoundError(err)) return null;
    throw err;
  }
}

/**
 * Tạo geo store đọc từ điển geo theo nước, cache module-level.
 * Cache theo Promise (không phải giá trị đã resolve) để 2 lệnh gọi song song
 * cho cùng 1 nước chỉ trigger đúng 1 lần fetchFile — tránh double-fetch.
 *
 * Promise không bao giờ reject: mọi lỗi (fetchFile throw, gzip hỏng, JSON hỏng) đều
 * bị bắt, console.warn, và resolve null — không crash form nhập đơn (D-008). Đồng thời
 * entry lỗi bị evict khỏi cache ngay (không cache "not found" giả do lỗi tạm thời) để
 * lần gọi kế tiếp tự retry; chỉ not-found THẬT (deps.fetchFile trả null, không throw)
 * mới được cache lại như trạng thái hợp lệ.
 */
export function createGeoStore(deps: GeoStoreDeps) {
  const cache = new Map<string, Promise<GeoCountryFile | null>>();

  function load(cc: string): Promise<GeoCountryFile | null> {
    const key = cc.toUpperCase();
    const cached = cache.get(key);
    if (cached) return cached;

    const promise = (async (): Promise<GeoCountryFile | null> => {
      let raw: Buffer | null;
      try {
        raw = await deps.fetchFile(key);
      } catch (err) {
        console.warn(`[geo-store] fetchFile("${key}") lỗi, không cache — lần gọi sau sẽ retry:`, err);
        cache.delete(key);
        return null;
      }
      if (!raw) return null; // not-found thật — cache lại như trạng thái hợp lệ

      try {
        const json = gunzipSync(raw).toString('utf-8');
        return JSON.parse(json) as GeoCountryFile;
      } catch (err) {
        console.warn(`[geo-store] Giải nén/parse geo-dict "${key}" lỗi, không cache — lần gọi sau sẽ retry:`, err);
        cache.delete(key);
        return null;
      }
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
