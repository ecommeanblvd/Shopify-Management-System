import { describe, it, expect } from 'vitest';
import { bocKhoanPhi, maCuaNhan, MA_THEO_NHAN, type MaKhoanPhi } from './bang-ke-khoan-phi';
import { shipHoPriceStructure } from './price-structure';

const dung = (over: Record<string, unknown> = {}) => shipHoPriceStructure({
  breakdown: { carrierCost: 100_000, base: 80_000, fuel: 20_000, fuelPercent: 25, vatPercent: 8 },
  carrierCostVnd: 100_000, chargedVnd: 150_000, markupPercent: 20,
  actualBill: { breakdown: { base: 80_000, fuel: 20_000, duty: 0, sell: { baseVnd: 96_000, fuelVnd: 24_000, vatVnd: 9_600, chargedVnd: 129_600, fuelPercent: 25, vatPercent: 8 } }, totalVnd: 100_000, weightKg: 1 },
  ...over,
});

describe('maCuaNhan — khoá bằng MÃ ỔN ĐỊNH, không bằng nhãn tiếng Việt', () => {
  it('nhận nhãn có phần giải thích trong ngoặc', () => {
    /* MMP lập trình theo payload này. Nhãn là chữ hiển thị và đã đổi vài lần trong dự án —
       khoá bằng nhãn là mỗi lần sửa câu chữ lại làm hỏng hệ thống của đối tác. */
    expect(maCuaNhan('Ký nhận (direct signature)')).toBe('signature');
    expect(maCuaNhan('Thuế / hải quan (duty) — ngoài cước, thu hộ')).toBe('duty');
    expect(maCuaNhan('Phí sửa địa chỉ (Address Correction)')).toBe('address_correction');
  });

  it('nhãn lạ trả null — KHÔNG đoán bừa', () => {
    expect(maCuaNhan('Khoản gì đó mới')).toBeNull();
  });

  it('mỗi mã chỉ ánh xạ từ MỘT nhãn — trùng là hai khoản gộp làm một, mất tiền', () => {
    const ma = MA_THEO_NHAN.map(([, m]) => m);
    expect(new Set(ma).size).toBe(ma.length);
  });
});

describe('bocKhoanPhi', () => {
  it('cộng mọi khoản ra ĐÚNG tổng — đây là thứ kế toán MMP sẽ kiểm đầu tiên', () => {
    const r = bocKhoanPhi(dung());
    expect(r.fees.reduce((t, f) => t + f.amountVnd, 0)).toBe(r.totalVnd);
    expect(r.totalVnd).toBeGreaterThan(0);
  });

  it('KHÔNG còn nhãn lạ — nhãn chưa ánh xạ là payload THIẾU TIỀN mà không ai biết', () => {
    /* Đây là test canh quan trọng nhất: thêm một dòng phí mới vào price-structure mà quên
       thêm mã thì khoản đó biến mất khỏi payload, tổng lệch, và MMP đối soát sai. */
    expect(bocKhoanPhi(dung()).nhanLa).toEqual([]);
  });

  it('gửi kèm % cho khoản tính theo tỉ lệ', () => {
    const fuel = bocKhoanPhi(dung()).fees.find((f) => f.code === 'fuel');
    expect(fuel?.percent).toBe(25);
  });

  it('BỎ khoản bằng 0 — payload là dữ liệu, không phải bảng cố định cột', () => {
    // MMP muốn bày đủ cột như file Đức thì khoản vắng mặt = 0.
    expect(bocKhoanPhi(dung()).fees.every((f) => f.amountVnd !== 0)).toBe(true);
  });

  it('không có cấu trúc giá thì trả rỗng, không vỡ', () => {
    expect(bocKhoanPhi(null)).toEqual({ fees: [], totalVnd: 0, nhanLa: [] });
  });

  it('mọi mã trả về đều thuộc danh sách đã khai', () => {
    const hopLe = new Set<MaKhoanPhi>(MA_THEO_NHAN.map(([, m]) => m));
    for (const f of bocKhoanPhi(dung()).fees) expect(hopLe.has(f.code)).toBe(true);
  });
});
