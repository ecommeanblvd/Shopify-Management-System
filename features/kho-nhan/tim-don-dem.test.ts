import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * CHẶN MÁY cho luật "chiếc trượt QC không tính là đã nhận" (CEO 03/10/2026).
 *
 * Luật nằm trong SQL nên không có hàm thuần nào để gọi; thứ dễ sai là THÊM một chỗ đếm thứ tư
 * mà quên lọc — đúng loại lỗi đã khiến 16 dòng đơn kẹt. Bài test đọc chính tệp nguồn và đòi mọi
 * lượt `count(*)` trên hai bảng nhận hàng phải mang mệnh đề lọc.
 */
const NGUON = readFileSync(new URL('./tim-don.ts', import.meta.url), 'utf8');

/** Cắt nguồn thành từng câu lệnh SELECT có đếm, để soi riêng từng câu. */
function cacCauDem(src: string): string[] {
  return src
    .split(/SELECT\s+/i).slice(1)
    .map((c) => `SELECT ${c.split('`')[0] ?? ''}`)
    .filter((c) => /count\(\*\)/i.test(c));
}

describe('tim-don: đếm đã nhận', () => {
  /* Con số này là CHỐT CHẶN, không phải mô tả: thêm một nguồn nhận hàng mà quên lọc chiếc fail
     thì bài test đỏ ở đây trước. Vế thứ tư (kênh món Lark, đơn TQ) và thứ năm (đồ return) thêm
     08/10/2026 — và đúng lúc thêm vế thứ tư, nó đã quên mệnh đề lọc; test này là chỗ bắt được. */
  it('có đúng năm chỗ đếm', () => {
    expect(cacCauDem(NGUON)).toHaveLength(5);
  });

  it('mọi lượt đếm trên goods_receipt_items đều loại chiếc fail', () => {
    const cau = cacCauDem(NGUON).filter((c) => /goods_receipt_items/.test(c));
    expect(cau.length).toBeGreaterThan(0);
    for (const c of cau) expect(c).toMatch(/\$\{KHONG_TINH_FAIL\}/);
  });

  it('lượt đếm trên bảng kho Lark loại dòng QC Failed', () => {
    const cau = cacCauDem(NGUON).filter((c) => /lark_wh_inventory/.test(c));
    expect(cau.length).toBeGreaterThan(0);
    for (const c of cau) expect(c).toMatch(/\$\{KHONG_TINH_FAIL_LARK\}/);
  });

  it('luật khai MỘT lần, không chép literal ra chỗ khác', () => {
    expect(NGUON.match(/IS DISTINCT FROM 'fail'/g)).toHaveLength(1);
    expect(NGUON.match(/'QC Failed'/g)).toHaveLength(1);
  });
});
