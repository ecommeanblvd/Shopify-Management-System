import { describe, it, expect } from 'vitest';
import { kiemTraSecret, docBodyPack, GIOI_HAN_BODY } from './xac-thuc';

describe('kiemTraSecret', () => {
  it('đúng secret → ok', () => expect(kiemTraSecret('abc123', 'abc123')).toEqual({ ok: true }));
  it('sai / thiếu header → 401', () => {
    expect(kiemTraSecret('abc124', 'abc123')).toEqual({ ok: false, status: 401, error: 'sai secret' });
    expect(kiemTraSecret(null, 'abc123')).toEqual({ ok: false, status: 401, error: 'sai secret' });
    expect(kiemTraSecret('abc12', 'abc123').ok).toBe(false); // khác độ dài, không throw
  });
  it('thiếu env → 503', () => {
    expect(kiemTraSecret('abc', undefined)).toEqual({ ok: false, status: 503, error: 'chưa cấu hình LARK_PACK_WEBHOOK_SECRET' });
    expect(kiemTraSecret('abc', '')).toEqual({ ok: false, status: 503, error: 'chưa cấu hình LARK_PACK_WEBHOOK_SECRET' });
  });
});

describe('docBodyPack', () => {
  it('JSON có record_id → ok', () => {
    expect(docBodyPack('{"record_id":"recXYZ","log_unique_code":"PK-1"}')).toEqual({ ok: true, recordId: 'recXYZ', logUniqueCode: 'PK-1' });
  });
  it('thiếu record_id / không phải JSON / quá 4KB → lỗi', () => {
    expect(docBodyPack('{}')).toEqual({ ok: false, status: 400, error: 'thiếu record_id' });
    expect(docBodyPack('xx')).toEqual({ ok: false, status: 400, error: 'body không phải JSON' });
    expect(docBodyPack('{"record_id":"' + 'a'.repeat(GIOI_HAN_BODY) + '"}')).toEqual({ ok: false, status: 413, error: 'body quá 4KB' });
  });
});
