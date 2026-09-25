import { describe, it, expect } from 'vitest';
import { timPhieuThieu, cauNhacThieu } from './thieu-dinh-kem';

const p = (receiptId: string, vendor: string | null) => ({ receiptId, vendor });
const a = (receiptId: string, loai: 'hang_den' | 'bb_ban_giao') => ({ receiptId, loai });

describe('timPhieuThieu', () => {
  it('đủ cả hai loại → không nằm trong danh sách thiếu', () => {
    expect(timPhieuThieu([p('r1', 'A')], [a('r1', 'hang_den'), a('r1', 'bb_ban_giao')]))
      .toEqual([]);
  });

  it('có ảnh mà chưa có biên bản → nêu đúng thứ còn thiếu', () => {
    const r = timPhieuThieu([p('r1', 'A')], [a('r1', 'hang_den')]);
    expect(r).toHaveLength(1);
    expect(r[0]!.thieu).toEqual(['bb_ban_giao']);
  });

  it('chưa có gì → thiếu cả hai', () => {
    expect(timPhieuThieu([p('r1', 'A')], [])[0]!.thieu).toEqual(['hang_den', 'bb_ban_giao']);
  });

  /* Ảnh của brand này không được tính cho lô của brand kia. */
  it('đính kèm của phiếu khác KHÔNG tính sang', () => {
    const r = timPhieuThieu([p('r1', 'A'), p('r2', 'B')], [a('r2', 'hang_den'), a('r2', 'bb_ban_giao')]);
    expect(r.map((x) => x.receiptId)).toEqual(['r1']);
  });
});

describe('cauNhacThieu', () => {
  it('nêu đích danh brand và thứ còn thiếu', () => {
    const c = cauNhacThieu(timPhieuThieu([p('r1', 'TomFried')], [a('r1', 'hang_den')]));
    expect(c).toContain('TomFried');
    expect(c).toContain('biên bản bàn giao');
    expect(c).not.toContain('ảnh hàng đến');
  });

  /* Câu nhắc phải nói rõ bấm lần nữa là ĐI TIẾP, không phải bị chặn — CEO
   * 25/09 chốt là không chặn cứng. */
  it('nói rõ bấm lần nữa vẫn đi tiếp được', () => {
    expect(cauNhacThieu(timPhieuThieu([p('r1', 'A')], []))).toContain('vẫn bắt đầu QC');
  });

  it('không thiếu gì → câu rỗng', () => {
    expect(cauNhacThieu([])).toBe('');
  });
});
