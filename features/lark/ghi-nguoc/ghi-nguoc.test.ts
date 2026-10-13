import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cheDoGhiNguoc, khopRecordTheoCode, chargeTu } from './ghi-nguoc';

describe('cheDoGhiNguoc', () => {
  it('"1" → ghi; "dry" → dry; trống/khác → tắt', () => {
    expect(cheDoGhiNguoc('1')).toBe('ghi');
    expect(cheDoGhiNguoc('dry')).toBe('dry');
    expect(cheDoGhiNguoc('')).toBe('tat');
    expect(cheDoGhiNguoc(undefined)).toBe('tat');
    expect(cheDoGhiNguoc('yes')).toBe('tat');
  });
});

describe('khopRecordTheoCode', () => {
  it('khoá là Log Unique code; dạng chuỗi lẫn rich text; dòng không có code bị bỏ', () => {
    const m = khopRecordTheoCode([
      { record_id: 'a', fields: { 'Log Unique code': 'PK-1' } },
      { record_id: 'b', fields: { 'Log Unique code': [{ text: 'PK-2', type: 'text' }] } },
      { record_id: 'c', fields: {} },
    ]);
    expect(m.get('PK-1')?.record_id).toBe('a');
    expect(m.get('PK-2')?.record_id).toBe('b');
    expect(m.size).toBe(2);
  });
});

/* ───── `chargeTu`: cầu nối từ DÒNG SQL sang `ChargeGhiNguoc` ─────
 *
 * Đây là chỗ khoản phí BỊ RƠI mà không ai thấy. `dungPatch` lặp `Object.entries(COT_CHI_PHI)`
 * rồi tra `khoan[khoa]`; khoá nào `chargeTu` không dựng ra thì giá trị là `undefined` ⇒ luật
 * `moi == null → continue` bỏ qua ô ĐÚNG NHƯ KHI KHÔNG CÓ SỐ. Không lỗi, không cảnh báo, ô
 * trống trên Lark trông y hệt "hãng không thu khoản đó".
 *
 * `address_correction` đã nằm im như vậy: cột Lark có (`Phí sửa địa chỉ`), khoá trong
 * `COT_CHI_PHI` có, `shipment_charges` có 63/6.027 dòng mang số thật — chỉ thiếu trường ở
 * `ChargeGhiNguoc` và cột trong câu SELECT. Hai test dưới khoá cả hai nửa đó lại.
 */
describe('chargeTu', () => {
  const dong = {
    code: 'PK-1', deliveryStatus: null, deliverySource: null, deliveredAt: null, labelCreatedAt: null,
    shipCountry: null, totalAmount: '1438453', base: '2244600', discount: '-1541142', fuel: '383043',
    remote: '0', demand: '0', directSignature: '92700', vat: '106552', gogreen: '0', elevatedRisk: '0',
    importHandling: '68300', residential: '84400', addressCorrection: '289200',
  };

  it('số `address_correction` của hoá đơn đi được vào `ChargeGhiNguoc`', () => {
    // `numeric` của Postgres về Node là CHUỖI, nên phải qua `Number` — bỏ bước này thì
    // `moi <= 0` so chuỗi với số và kết quả tuỳ chuỗi, không phải lỗi biên dịch.
    expect(chargeTu(dong)?.addressCorrection).toBe(289_200);
  });
  it('kiện không có khoản sửa địa chỉ → `null`, KHÔNG phải `0`', () => {
    // Phân biệt này quan trọng: `null` nghĩa là "hãng không thu", và `dungPatch` bỏ qua ô —
    // chứ không ghi `0` vào Lark. Ghi `0` là khoá ô ở 0 vĩnh viễn (lượt sau đọc `docSo = 0`
    // tức ĐÃ CÓ nên không điền số thật vào được nữa, mà Lark không có undo).
    expect(chargeTu({ ...dong, addressCorrection: null })?.addressCorrection).toBeNull();
  });

  /* Lá chắn cho cả HỌ lỗi, không chỉ riêng ca `address_correction`: mỗi trường của
   * `ChargeGhiNguoc` phải thực sự được câu SELECT lấy về. Thêm trường mà quên cột (đúng lỗi
   * hôm nay) thì `chargeTu` đọc `r.<trường>` ra `undefined` ⇒ khoản im lặng mất. TypeScript
   * KHÔNG bắt được: `DongKien` là kiểu ta tự khai cho `db.execute`, Postgres không kiểm nó. */
  it('mọi trường của `ChargeGhiNguoc` đều có cột tương ứng trong câu SELECT', () => {
    const nguon = readFileSync(new URL('./ghi-nguoc.ts', import.meta.url), 'utf8');
    for (const khoa of Object.keys(chargeTu(dong)!)) {
      const snake = khoa.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      // Cột tên khác camelCase thì phải có bí danh `AS "khoá"`; tên trùng thì `c.khoá` là đủ.
      const coCot = nguon.includes(`AS "${khoa}"`) || new RegExp(`c\\.${snake}\\b`).test(nguon);
      expect(coCot, `câu SELECT thiếu cột cho trường "${khoa}"`).toBe(true);
    }
  });
});
