import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { createGeoStore, type GeoCountryFile, type GeoStoreDeps } from './geo-store';

// Fixture 2 nước nhỏ (ASCII để tránh phụ thuộc locale-sort khi assert thứ tự).
const AA_FILE: GeoCountryFile = {
  cities: [
    { name: 'Boston', stateCode: 'MA' },
    { name: 'Austin', stateCode: 'TX' },
    { name: 'Dallas', stateCode: 'TX' },
  ],
  postcodes: {
    '10001': [{ city: 'Boston', stateCode: 'MA' }, { city: 'Cambridge', stateCode: 'MA' }],
  },
};

const BB_FILE: GeoCountryFile = {
  cities: [
    { name: 'Zurich', stateCode: null },
    { name: 'Geneva', stateCode: null },
  ],
  postcodes: {
    '8000': [{ city: 'Zurich', stateCode: null }],
  },
};

const gz = (file: GeoCountryFile): Buffer => gzipSync(Buffer.from(JSON.stringify(file)));

function makeDeps(): { deps: GeoStoreDeps; fetchFile: ReturnType<typeof vi.fn> } {
  const files: Record<string, Buffer> = { AA: gz(AA_FILE), BB: gz(BB_FILE) };
  const fetchFile = vi.fn(async (cc: string) => files[cc.toUpperCase()] ?? null);
  return { deps: { fetchFile }, fetchFile };
}

describe('createGeoStore', () => {
  it('getCities trả tất cả city đã sort asc khi không lọc state', async () => {
    const { deps } = makeDeps();
    const store = createGeoStore(deps);
    await expect(store.getCities('AA')).resolves.toEqual(['Austin', 'Boston', 'Dallas']);
    await expect(store.getCities('BB')).resolves.toEqual(['Geneva', 'Zurich']);
  });

  it('getCities lọc theo stateCode khi truyền state', async () => {
    const { deps } = makeDeps();
    const store = createGeoStore(deps);
    await expect(store.getCities('AA', 'TX')).resolves.toEqual(['Austin', 'Dallas']);
    await expect(store.getCities('AA', 'MA')).resolves.toEqual(['Boston']);
  });

  it('getPostcode trả candidates khi hit, [] khi miss trong nước đã có file', async () => {
    const { deps } = makeDeps();
    const store = createGeoStore(deps);
    await expect(store.getPostcode('AA', '10001')).resolves.toEqual([
      { city: 'Boston', stateCode: 'MA' },
      { city: 'Cambridge', stateCode: 'MA' },
    ]);
    await expect(store.getPostcode('AA', '99999')).resolves.toEqual([]);
  });

  it('getPostcodeSet trả Set các key postcode', async () => {
    const { deps } = makeDeps();
    const store = createGeoStore(deps);
    await expect(store.getPostcodeSet('AA')).resolves.toEqual(new Set(['10001']));
    await expect(store.getPostcodeSet('BB')).resolves.toEqual(new Set(['8000']));
  });

  it('nước không có file → null cho cả 3 hàm', async () => {
    const { deps } = makeDeps();
    const store = createGeoStore(deps);
    await expect(store.getCities('ZZ')).resolves.toBeNull();
    await expect(store.getPostcode('ZZ', '10001')).resolves.toBeNull();
    await expect(store.getPostcodeSet('ZZ')).resolves.toBeNull();
  });

  it('cache: fetchFile gọi đúng 1 lần/nước, kể cả gọi song song 2 hàm khác nhau (share in-flight promise)', async () => {
    const { deps, fetchFile } = makeDeps();
    const store = createGeoStore(deps);
    const [cities, postcode] = await Promise.all([
      store.getCities('AA'),
      store.getPostcode('AA', '10001'),
    ]);
    expect(cities).toEqual(['Austin', 'Boston', 'Dallas']);
    expect(postcode).toEqual(AA_FILE.postcodes['10001']);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(fetchFile).toHaveBeenCalledWith('AA');

    // gọi lại (tuần tự, sau khi đã resolve) vẫn dùng cache, không fetch lại
    await store.getCities('AA');
    await store.getPostcodeSet('AA');
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  it('cache theo cc.toUpperCase() — gọi bằng chữ thường vẫn share cache với chữ hoa', async () => {
    const { deps, fetchFile } = makeDeps();
    const store = createGeoStore(deps);
    await store.getCities('aa');
    await store.getCities('AA');
    expect(fetchFile).toHaveBeenCalledTimes(1);
  });

  it('invalidate(cc) xoá cache của đúng 1 nước, nước khác giữ nguyên', async () => {
    const { deps, fetchFile } = makeDeps();
    const store = createGeoStore(deps);
    await store.getCities('AA');
    await store.getCities('BB');
    expect(fetchFile).toHaveBeenCalledTimes(2);

    store.invalidate('AA');
    await store.getCities('AA');
    await store.getCities('BB');
    expect(fetchFile).toHaveBeenCalledTimes(3);
  });

  it('invalidate() không tham số xoá toàn bộ cache', async () => {
    const { deps, fetchFile } = makeDeps();
    const store = createGeoStore(deps);
    await store.getCities('AA');
    await store.getCities('BB');
    store.invalidate();
    await store.getCities('AA');
    await store.getCities('BB');
    expect(fetchFile).toHaveBeenCalledTimes(4);
  });

  it('not-found thật (deps.fetchFile resolve null, không throw) → cache lại, chỉ gọi 1 lần dù hỏi nhiều hàm', async () => {
    const { deps, fetchFile } = makeDeps(); // 'ZZ' không có trong fixture → fetchFile resolve null
    const store = createGeoStore(deps);
    await store.getCities('ZZ');
    await store.getPostcode('ZZ', '10001');
    await store.getPostcodeSet('ZZ');
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(fetchFile).toHaveBeenCalledWith('ZZ');
  });

  it('gzip hỏng (corrupt) → null + console.warn, KHÔNG cache, lần gọi sau retry fetchFile', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFile = vi.fn(async () => Buffer.from('day khong phai gzip hop le'));
    const store = createGeoStore({ fetchFile });

    await expect(store.getCities('AA')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(fetchFile).toHaveBeenCalledTimes(1);

    // lần sau vẫn retry (không bị cache lỗi vĩnh viễn), không throw ra ngoài
    await expect(store.getCities('AA')).resolves.toBeNull();
    expect(fetchFile).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });

  it('deps.fetchFile throw lỗi (network-ish) → null cho lần gọi này, KHÔNG cache, lần sau retry thành công được', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const fetchFile = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('ETIMEDOUT');
      return gz(AA_FILE);
    });
    const store = createGeoStore({ fetchFile });

    await expect(store.getCities('AA')).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(fetchFile).toHaveBeenCalledTimes(1);

    // không bị cache là "không có file" — retry và lần này fetchFile trả dữ liệu thật
    await expect(store.getCities('AA')).resolves.toEqual(['Austin', 'Boston', 'Dallas']);
    expect(fetchFile).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });
});

describe('geoStore (default instance dùng Supabase Storage qua @/lib/storage/s3)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('đọc key geo-dict/<CC>.json.gz, gunzip + parse đúng file', async () => {
    const getObject = vi.fn(async (key: string) => {
      expect(key).toBe('geo-dict/AA.json.gz');
      return new Uint8Array(gz(AA_FILE));
    });
    vi.doMock('@/lib/storage/s3', () => ({ getObject }));
    const { geoStore } = await import('./geo-store');
    await expect(geoStore.getCities('aa')).resolves.toEqual(['Austin', 'Boston', 'Dallas']);
    expect(getObject).toHaveBeenCalledWith('geo-dict/AA.json.gz');
  });

  it('getObject throw lỗi NoSuchKey thật (AWS SDK {name:"NoSuchKey"}) → null, cache lại (getObject chỉ gọi 1 lần)', async () => {
    const err = Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' });
    const getObject = vi.fn(async () => { throw err; });
    vi.doMock('@/lib/storage/s3', () => ({ getObject }));
    const { geoStore } = await import('./geo-store');
    await expect(geoStore.getCities('ZZ')).resolves.toBeNull();
    await expect(geoStore.getPostcode('ZZ', '1')).resolves.toBeNull();
    expect(getObject).toHaveBeenCalledTimes(1);
  });

  it('getObject throw lỗi 404 qua $metadata.httpStatusCode → cũng coi là not-found, cache lại', async () => {
    const err = Object.assign(new Error('Not Found'), { $metadata: { httpStatusCode: 404 } });
    const getObject = vi.fn(async () => { throw err; });
    vi.doMock('@/lib/storage/s3', () => ({ getObject }));
    const { geoStore } = await import('./geo-store');
    await expect(geoStore.getCities('ZZ')).resolves.toBeNull();
    await expect(geoStore.getCities('ZZ')).resolves.toBeNull();
    expect(getObject).toHaveBeenCalledTimes(1);
  });

  it('getObject throw lỗi network chung (không phải not-found) → null lần này, KHÔNG cache, retry lần sau thành công', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let calls = 0;
    const getObject = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error('ETIMEDOUT');
      return new Uint8Array(gz(AA_FILE));
    });
    vi.doMock('@/lib/storage/s3', () => ({ getObject }));
    const { geoStore } = await import('./geo-store');

    await expect(geoStore.getCities('AA')).resolves.toBeNull();
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();

    await expect(geoStore.getCities('AA')).resolves.toEqual(['Austin', 'Boston', 'Dallas']);
    expect(getObject).toHaveBeenCalledTimes(2);

    warn.mockRestore();
  });
});
