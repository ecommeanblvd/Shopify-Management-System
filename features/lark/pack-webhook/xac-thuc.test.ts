import { describe, it, expect } from 'vitest';
import { kiemTraSecret, docBodyPack, laBienChuaThay, GIOI_HAN_BODY } from './xac-thuc';

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
  it('record_id → nhận diện theo record', () => {
    expect(docBodyPack('{"record_id":"recXYZ"}')).toEqual({ ok: true, nhanDien: { kieu: 'record', giaTri: 'recXYZ' } });
  });

  it('không có record_id nhưng có mã kiện / mã đơn → vẫn nhận', () => {
    expect(docBodyPack('{"log_unique_code":"PK-21997"}')).toEqual({ ok: true, nhanDien: { kieu: 'log_code', giaTri: 'PK-21997' } });
    expect(docBodyPack('{"order_number":"#MBLVD30508"}')).toEqual({ ok: true, nhanDien: { kieu: 'don', giaTri: '#MBLVD30508' } });
  });

  it('rule Lark gõ tay biến → báo đúng lý do, không lặng lẽ bỏ qua', () => {
    const r = docBodyPack('{"record_id":"{{record_id}}"}');
    expect(r).toEqual({ ok: false, status: 400, error: 'rule Lark gửi nguyên chữ {{...}} — phải chèn biến từ menu, không gõ tay' });
  });

  it('biến chưa thay ở record_id nhưng mã đơn thật → vẫn chạy được', () => {
    expect(docBodyPack('{"record_id":"{{record_id}}","order_number":"#MBLVD30508"}'))
      .toEqual({ ok: true, nhanDien: { kieu: 'don', giaTri: '#MBLVD30508' } });
  });

  it('không có gì / không phải JSON / quá 4KB', () => {
    expect(docBodyPack('{}')).toEqual({ ok: false, status: 400, error: 'cần record_id, log_unique_code hoặc order_number' });
    expect(docBodyPack('xx')).toEqual({ ok: false, status: 400, error: 'body không phải JSON' });
    expect(docBodyPack('{"record_id":"' + 'a'.repeat(GIOI_HAN_BODY) + '"}')).toEqual({ ok: false, status: 413, error: 'body quá 4KB' });
  });
});

describe('laBienChuaThay', () => {
  it('nhận chuỗi còn nguyên dấu ngoặc kép của Lark', () => {
    expect(laBienChuaThay('{{record_id}}')).toBe(true);
    expect(laBienChuaThay('recvvUMlyvRdlf')).toBe(false);
  });
});
