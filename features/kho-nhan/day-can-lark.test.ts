import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { oCanLarkTrong, chonUngVienDayCan, type KetQuaDayCan } from './day-can-lark';
import { COT_CAN_LARK, CAN_TOI_DA_KG } from './can-tu-lark';
import type { LarkRecord } from '@/features/lark/client';

const dong = (id: string, can?: unknown): LarkRecord =>
  ({ record_id: id, fields: can === undefined ? {} : { [COT_CAN_LARK]: can } });

describe('oCanLarkTrong', () => {
  it('thiếu cột, null, chuỗi rỗng → TRỐNG (được điền)', () => {
    expect(oCanLarkTrong(dong('r1'))).toBe(true);
    expect(oCanLarkTrong(dong('r1', null))).toBe(true);
    expect(oCanLarkTrong(dong('r1', ''))).toBe(true);
  });

  /* Ô có số 0 KHÔNG phải ô trống: ai đó đã gõ vào đó. Coi 0 là trống rồi ghi đè là tự cho
     mình quyền sửa số người khác — đúng cái điều kiện CEO đặt ra để chặn. */
  it('có số (kể cả 0) → KHÔNG trống, tuyệt đối không đụng', () => {
    expect(oCanLarkTrong(dong('r1', 0))).toBe(false);
    expect(oCanLarkTrong(dong('r1', 0.4))).toBe(false);
    expect(oCanLarkTrong(dong('r1', '0,5'))).toBe(false);
  });

  it('không có dòng Lark → KHÔNG coi là trống (không có gì để ghi vào)', () => {
    expect(oCanLarkTrong(null)).toBe(false);
    expect(oCanLarkTrong(undefined)).toBe(false);
  });
});

describe('chonUngVienDayCan', () => {
  it('chỉ chọn chiếc có cân bên mình VÀ ô Lark trống', () => {
    const r = chonUngVienDayCan(
      [{ recordId: 'rTrong', canKg: '0.400' }, { recordId: 'rDaCo', canKg: '0.500' }],
      [dong('rTrong'), dong('rDaCo', 1.2)],
    );
    expect(r.chon).toEqual([{ recordId: 'rTrong', can: 0.4 }]);
    expect(r.larkDaCo).toBe(1);
  });

  it('cân bên mình vô lý thì KHÔNG đẩy rác sang Lark', () => {
    const r = chonUngVienDayCan(
      [{ recordId: 'a', canKg: '0' }, { recordId: 'b', canKg: String(CAN_TOI_DA_KG + 1) },
        { recordId: 'c', canKg: 'nặng' }, { recordId: 'd', canKg: null }],
      [dong('a'), dong('b'), dong('c'), dong('d')],
    );
    expect(r.chon).toEqual([]);
    expect(r.canVoLy).toBe(4);
  });

  it('dòng Lark đã bị xoá → đếm riêng, không lẫn vào "Lark đã có"', () => {
    const r = chonUngVienDayCan([{ recordId: 'mat', canKg: '0.400' }], []);
    expect(r.chon).toEqual([]);
    expect(r.khongThayDong).toBe(1);
    expect(r.larkDaCo).toBe(0);
  });

  it('ba lý do bỏ qua được đếm RIÊNG — gộp lại là mất lý do', () => {
    const r = chonUngVienDayCan(
      [{ recordId: 'ok', canKg: '0.400' }, { recordId: 'daCo', canKg: '0.400' },
        { recordId: 'rac', canKg: '-1' }, { recordId: 'mat', canKg: '0.400' }],
      [dong('ok'), dong('daCo', 2), dong('rac')],
    );
    expect(r.chon.map((x) => x.recordId)).toEqual(['ok']);
    expect({ larkDaCo: r.larkDaCo, canVoLy: r.canVoLy, khongThayDong: r.khongThayDong })
      .toEqual({ larkDaCo: 1, canVoLy: 1, khongThayDong: 1 });
  });
});

/* 08/10/2026: đọc `job_runs` của việc này để biết `WH_GHI_CAN_LARK` đang bật hay tắt thì KHÔNG
 * kết luận được — mọi ô Lark đã có số nên không dòng nào tới bước kiểm chế độ, và `dry: 0,
 * ghi: 0` ra giống hệt nhau ở cả ba chế độ. Lượt chạy phải TỰ KHAI chế độ. */
describe('KetQuaDayCan.cheDo', () => {
  it('có trường `cheDo` trong kiểu kết quả — nếu không, không ai đọc được lượt chạy ở chế độ nào', () => {
    const mau: KetQuaDayCan = {
      cheDo: 'that',
      ungVien: 0, larkDaCo: 0, canVoLy: 0, khongThayDong: 0, dry: 0, vuaBiDien: 0, ghi: 0, loi: 0,
    };
    expect(mau.cheDo).toBe('that');
  });

  /* Hàng rào đọc nguồn: `cheDo` phải được gán khi DỰNG `ra`, trước mọi lối thoát sớm. Gán ở
     giữa vòng lặp ghi là lượt "không có ứng viên nào" lại không khai được chế độ — đúng ca đã
     làm em đoán sai. */
  it('gán chế độ TRƯỚC mọi lối thoát sớm', async () => {
    const src = await readFile(new URL('./day-can-lark.ts', import.meta.url), 'utf8');
    const iDoc = src.indexOf('docCheDoGhi(process.env.WH_GHI_CAN_LARK)');
    const iRa = src.indexOf('const ra: KetQuaDayCan = {');
    const iThoat = src.indexOf('if (smsCan.length === 0) return ra;');
    expect(iDoc).toBeGreaterThan(-1);
    expect(iRa).toBeGreaterThan(iDoc);
    expect(iThoat).toBeGreaterThan(iRa);
    expect(src.slice(iRa, iThoat)).toContain('cheDo: cheDo.kieu');
  });
});
