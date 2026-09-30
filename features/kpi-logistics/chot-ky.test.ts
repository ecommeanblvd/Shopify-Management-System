import { describe, it, expect } from 'vitest';
import { chuanHoaAuto, laAnhChupHopLe, laKyHopLe } from './chot-ky';

describe('laKyHopLe / laAnhChupHopLe', () => {
  it('kỳ phải đúng dạng YYYY-MM', () => {
    expect(laKyHopLe('2026-08')).toBe(true);
    expect(laKyHopLe('2026-13')).toBe(false);
    expect(laKyHopLe('2026-8')).toBe(false);
    expect(laKyHopLe('linh tinh')).toBe(false);
  });

  it('ảnh chụp hỏng hoặc đời khác thì KHÔNG nhận — dữ liệu trong jsonb là thứ đã nằm sẵn ở CSDL', () => {
    expect(laAnhChupHopLe({ ban: 1, auto: {}, diemP1: 0.85 })).toBe(true);
    expect(laAnhChupHopLe({ ban: 2, auto: {}, diemP1: 0.85 })).toBe(false);
    expect(laAnhChupHopLe({ ban: 1, diemP1: 0.85 })).toBe(false);
    expect(laAnhChupHopLe(null)).toBe(false);
    expect(laAnhChupHopLe('chuỗi')).toBe(false);
  });
});


describe('chuanHoaAuto — ảnh chụp cũ thiếu trường thêm sau ngày chốt (CEO 30/09/2026)', () => {
  /* Lỗi thật: `bienCuoc` thêm vào SAU khi kỳ tháng 8 đã chốt, nên ảnh chụp không có nó và màn
     đọc `auto.bienCuoc.tonChuaPhanDinh` VỠ TRẮNG. 4.184 test không bắt được vì test nào cũng
     dựng đối tượng đầy đủ — chỉ ảnh chụp THẬT mới thiếu. */
  const anhCu = { tu: '2026-08-01', den: '2026-08-31', soDonAmCuoc: 58 } as unknown as Parameters<typeof chuanHoaAuto>[0];

  it('lấp trường thiếu thay vì để undefined làm vỡ màn', () => {
    const r = chuanHoaAuto(anhCu);
    expect(r.bienCuoc).toBeDefined();
    expect(r.bienCuoc.tonChuaPhanDinh).toBe(0);
    expect(r.chungTuThieu.danhSach).toEqual([]);
  });

  it('mặc định TRUNG TÍNH — tỉ lệ để null, không bịa thành 0 %', () => {
    // null = "ảnh chụp này không có số đó"; 0 % là một KẾT LUẬN, và nó sai.
    expect(chuanHoaAuto(anhCu).bienCuoc.tyLeTien).toBeNull();
  });

  it('KHÔNG đè lên số đã có trong ảnh chụp', () => {
    const coSan = { ...anhCu, bienCuoc: { tongCuocVnd: 9, amDoLoiNoiBoVnd: 3, tyLeTien: 0.33, tonChuaPhanDinh: 7 } } as Parameters<typeof chuanHoaAuto>[0];
    expect(chuanHoaAuto(coSan).bienCuoc.tyLeTien).toBe(0.33);
    expect(chuanHoaAuto(coSan).bienCuoc.tonChuaPhanDinh).toBe(7);
  });

  it('giữ nguyên mọi trường cũ, không làm mất gì', () => {
    expect(chuanHoaAuto(anhCu).soDonAmCuoc).toBe(58);
    expect(chuanHoaAuto(anhCu).tu).toBe('2026-08-01');
  });
});

describe('ảnh chụp phải đóng băng CẢ CÔNG THỨC, không chỉ đầu vào (CEO 30/09/2026)', () => {
  /* Lỗi gốc: ảnh chụp chỉ giữ số liệu, còn màn TÍNH LẠI bảng điểm mỗi lần mở. Nên đổi cách chấm
     một tiêu chí là điểm của MỌI kỳ đã chốt tự đổi theo — âm thầm, không ai mở lại kỳ nào.
     Phát hiện đúng lúc đổi 1.1 sang tỉ lệ tiền: điểm tháng 8 sẽ tự tụt 85 % → 70 %. */
  it('kiểu dữ liệu ảnh chụp có chỗ giữ bảng điểm', () => {
    const anh = { ban: 1 as const, auto: {}, nhap: null, diemP1: 0.85, gateDat: true,
      bangDiem: { p1: [], diemP1: 0.85, p2: [], p3: [], gateDat: true } };
    expect(laAnhChupHopLe(anh)).toBe(true);
    expect(anh.bangDiem.diemP1).toBe(0.85);
  });

  it('ảnh chụp ĐỜI CŨ không có bảng điểm — vẫn đọc được, màn sẽ tính lại', () => {
    // Không được từ chối ảnh cũ: kỳ tháng 8 chốt trước khi có trường này.
    expect(laAnhChupHopLe({ ban: 1, auto: {}, diemP1: 0.85 })).toBe(true);
  });
});
