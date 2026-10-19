import { describe, it, expect } from 'vitest';
import { dongTongLichSu, khoiThang, nhayTab } from './day-tab-lich-su';

describe('dongTongLichSu', () => {
  it('đặt chữ "Tổng" ở cột B, cột A để trống — theo nếp sheet brand đã quen mắt', () => {
    const d = dongTongLichSu(5, [3], 2);
    expect(d[0]).toBe('');
    expect(d[1]).toBe('Tổng');
  });

  it('ô tiền là CÔNG THỨC SUM, không phải số tính sẵn: brand lọc một dòng thì tổng đổi theo', () => {
    // 3 dòng dữ liệu ⇒ hàng 2..4.
    expect(dongTongLichSu(21, [7, 19], 3)[7]).toBe('=SUM(H2:H4)');
    expect(dongTongLichSu(21, [7, 19], 3)[19]).toBe('=SUM(T2:T4)');
  });

  it('cột quá Z vẫn ra chữ cột đúng', () => {
    expect(dongTongLichSu(30, [26], 1)[26]).toBe('=SUM(AA2:AA2)');
  });

  it('bảng KHÔNG có dòng nào thì ô tiền để TRỐNG, không ra =SUM(T2:T1)', () => {
    const d = dongTongLichSu(21, [19], 0);
    expect(d[19]).toBe('');
    expect(d[1]).toBe('Tổng');
  });
});

describe('khoiThang', () => {
  it('mỗi tháng là một khối hàng liền nhau, tính từ hàng 2 vì hàng 1 là tiêu đề', () => {
    const k = khoiThang([
      { ngay: '2025-07-17' }, { ngay: '2025-07-28' },
      { ngay: '2025-08-13' }, { ngay: '2025-08-25' }, { ngay: '2025-08-25' },
      { ngay: '2025-10-30' },
    ]);
    expect(k.get('2025-07')).toEqual({ tu: 2, den: 3 });
    expect(k.get('2025-08')).toEqual({ tu: 4, den: 6 });
    expect(k.get('2025-10')).toEqual({ tu: 7, den: 7 });
    // Tháng 9 không có đơn ⇒ không có khối, chứ không phải khối rỗng.
    expect(k.has('2025-09')).toBe(false);
  });

  it('một đơn lẻ ra khối một hàng', () => {
    expect(khoiThang([{ ngay: '2026-03-23' }]).get('2026-03')).toEqual({ tu: 2, den: 2 });
  });

  /* Khối phải LIỀN NHAU mới dùng được `=SUM(T2:T3)` một tham số — nếu danh sách chưa sắp theo
   * ngày thì khối của một tháng sẽ trùm lên tháng khác và tổng cộng sai sang dòng bên cạnh.
   * Hàm không tự sắp (người gọi sắp), nên test này ghim lại hậu quả để không ai tưởng nó an toàn. */
  it('danh sách CHƯA sắp theo ngày thì khối trùm lên nhau — người gọi phải sắp trước', () => {
    const k = khoiThang([{ ngay: '2025-08-13' }, { ngay: '2025-07-17' }, { ngay: '2025-08-25' }]);
    expect(k.get('2025-08')).toEqual({ tu: 2, den: 4 });
    expect(k.get('2025-07')).toEqual({ tu: 3, den: 3 });
  });
});

describe('nhayTab', () => {
  it('bọc nháy đơn để tên tab có khoảng trắng và dấu chấm dùng được trong công thức', () => {
    expect(nhayTab('Bán lẻ 7.2025-3.2026')).toBe("'Bán lẻ 7.2025-3.2026'");
  });

  it('nháy đơn trong tên được nhân đôi, không làm vỡ công thức', () => {
    expect(nhayTab("Đơn c'ũ")).toBe("'Đơn c''ũ'");
  });
});
