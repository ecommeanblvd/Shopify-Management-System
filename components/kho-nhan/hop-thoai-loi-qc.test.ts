import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * CHẶN MÁY cho lỗi Bảo báo 09/10/2026: "quá nhiều ảnh lúc QC fail làm mất nút xác nhận do
 * không kéo xuống được".
 *
 * Khối nhập lỗi (`KhoiLoi`) dài ra theo số chỗ lỗi. Hộp thoại chứa nó mà không có trần chiều
 * cao thì nó tràn khỏi màn hình và nút lưu — nằm cuối khối — không bấm tới được. `ModalQc` vốn
 * đã có trần; `OAnhLoiQc` thì không, và đó là màn đội kho bấm hằng ngày.
 *
 * Test đọc chính tệp nguồn vì luật nằm ở lớp CSS của hộp thoại, không có hàm thuần nào để gọi,
 * và Radix vẽ qua Portal nên kết xuất phía máy chủ ra rỗng.
 */
const doc = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

const HOP_THOAI = ['OAnhLoiQc.tsx', 'ModalQc.tsx'];

describe('hộp thoại chứa khối nhập lỗi QC', () => {
  it('mọi hộp thoại chứa KhoiLoi đều có trần chiều cao', () => {
    for (const f of HOP_THOAI) {
      const s = doc(f);
      expect(s).toContain('KhoiLoi');
      expect(s, `${f} thiếu trần chiều cao`).toMatch(/DialogContent[^>]*max-h-\[9\d*vh\]|DialogContent[^>]*h-\[9\d*vh\]/);
    }
  });

  it('phần thân cuộn được, không chỉ cắt cụt', () => {
    const s = doc('OAnhLoiQc.tsx');
    expect(s).toContain('overflow-y-auto');
    /* `min-h-0` là bắt buộc: con của flex không co dưới nội dung nên không có nó thì
       `overflow-y-auto` không bao giờ kích hoạt — hộp thoại vẫn tràn y như cũ. */
    expect(s).toContain('min-h-0');
  });
});
