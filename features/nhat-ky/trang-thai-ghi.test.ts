import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cauKhiTrong, CAU_KHONG_TRA_DUOC, dangGhi, tenTrigger, type TrangThaiBang,
} from './trang-thai-ghi';

const bangNay = (daGhi: boolean): TrangThaiBang[] => [
  { bang: 'shipments', nhan: 'Kiện hàng', daGhi },
];

describe('tenTrigger', () => {
  it('khớp đúng tên mà sinhTrigger đặt — nếu lệch thì màn hình nói sai chiều ngược lại', () => {
    expect(tenTrigger('goods_receipt_items')).toBe('nhat_ky_goods_receipt_items');
  });

  /* Chốt bằng chính MÃ SINH TRIGGER, không bằng một chuỗi gõ tay: hai chỗ cùng gõ
     `nhat_ky_` thì đổi tiền tố ở một chỗ vẫn xanh test, mà câu tra `pg_trigger` thì
     không thấy gì nữa — và panel đi nói "chưa bật" cho một bảng đang ghi. */
  it('tiền tố lấy cùng nguồn với câu CREATE TRIGGER của sinh-trigger.ts', () => {
    const nguon = readFileSync(new URL('./sinh-trigger.ts', import.meta.url), 'utf8');
    const m = /CREATE TRIGGER (\w+)\$\{bang\}/.exec(nguon);
    expect(m, 'sinh-trigger.ts không còn câu `CREATE TRIGGER <tiền tố>${bang}`').not.toBeNull();
    expect(tenTrigger('x')).toBe(`${m![1]}x`);
  });
});

describe('dangGhi', () => {
  it('không có dòng trong pg_trigger → chưa bật', () => {
    expect(dangGhi(undefined)).toBe(false);
    expect(dangGhi(null)).toBe(false);
  });

  it("'D' là trigger CÓ đó nhưng đang tắt → vẫn là không ghi gì", () => {
    expect(dangGhi('D')).toBe(false);
  });

  it("'O' / 'A' / 'R' đều là đang ghi", () => {
    expect(dangGhi('O')).toBe(true);
    expect(dangGhi('A')).toBe(true);
    expect(dangGhi('R')).toBe(true);
  });
});

describe('cauKhiTrong', () => {
  it('một bảng CHƯA bật: nói thẳng là chưa bật, và nói rõ im lặng không phải bằng chứng', () => {
    const c = cauKhiTrong(bangNay(false));
    expect(c).toContain('Chưa bật ghi nhật ký');
    expect(c).not.toContain('có thể');
    expect(c).toMatch(/không có gì được ghi/);
  });

  it('một bảng ĐÃ bật: nói thẳng là đã bật, nên trống đúng nghĩa là chưa ai sửa', () => {
    const c = cauKhiTrong(bangNay(true));
    expect(c).toContain('Đã bật ghi nhật ký');
    expect(c).toContain('chưa có thay đổi nào được ghi');
    expect(c).not.toContain('Chưa bật');
  });

  /* Hai câu phải KHÁC NHAU — đó là cả lý do tồn tại của hàm này. */
  it('hai ca cho ra hai câu khác nhau', () => {
    expect(cauKhiTrong(bangNay(true))).not.toBe(cauKhiTrong(bangNay(false)));
  });

  it('nhiều bảng cùng bật: kể tên để biết panel đang soi những bảng nào', () => {
    const c = cauKhiTrong([
      { bang: 'goods_receipts', nhan: 'Lô nhập kho', daGhi: true },
      { bang: 'goods_receipt_items', nhan: 'Chiếc trong lô nhập kho', daGhi: true },
    ]);
    expect(c).toContain('Lô nhập kho');
    expect(c).toContain('Chiếc trong lô nhập kho');
    expect(c).not.toContain('CHƯA bật');
  });

  it('nửa bật nửa chưa: phải kể rõ bảng nào chưa, không gộp thành một câu "đã bật"', () => {
    const c = cauKhiTrong([
      { bang: 'goods_receipt_items', nhan: 'Chiếc trong lô nhập kho', daGhi: true },
      { bang: 'goods_receipts', nhan: 'Lô nhập kho', daGhi: false },
    ]);
    expect(c).toContain('Đã bật ghi nhật ký cho Chiếc trong lô nhập kho');
    expect(c).toContain('CHƯA bật cho Lô nhập kho');
  });

  it('không khai bảng nào: vẫn ra chữ, không để panel trống trơn', () => {
    expect(cauKhiTrong([])).not.toBe('');
  });
});

describe('CAU_KHONG_TRA_DUOC', () => {
  /* Ca "không tra được" phải là ca THỨ BA. Nó mà trùng một trong hai câu dứt khoát là lỗi
     tra `pg_trigger` biến thành một lời khẳng định — đúng kiểu nói sai đang đi sửa. */
  it('không trùng câu "đã bật" lẫn câu "chưa bật"', () => {
    expect(CAU_KHONG_TRA_DUOC).not.toBe(cauKhiTrong(bangNay(true)));
    expect(CAU_KHONG_TRA_DUOC).not.toBe(cauKhiTrong(bangNay(false)));
  });

  it('nói thẳng là chưa tra được, không khẳng định chiều nào', () => {
    expect(CAU_KHONG_TRA_DUOC).toContain('Không tra được');
    expect(CAU_KHONG_TRA_DUOC).toContain('chưa kết luận được');
  });
});
