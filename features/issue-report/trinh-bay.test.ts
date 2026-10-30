import { describe, expect, it } from 'vitest';
import { nhanNguoiSuKien, nhanNguoiBao, laLienKetAnToan, cauChuaXuLy } from './trinh-bay';
import { NGUOI_TU_DONG, TRANG_THAI } from './phan-loai';

describe('nhanNguoiSuKien', () => {
  it('dòng của bot ghi "ghi qua đường tự động", không ghi "Hệ thống tự động"', () => {
    // Nhãn "Hệ thống tự động" KHẲNG ĐỊNH bot đã làm. Nhưng đường PATCH /api/issues đóng cứng
    // người thực hiện là bot, nên có dòng như thế thật ra do người làm tay (thiết kế §7) —
    // nhãn đó tạo ra đúng sự hiểu lầm anti-goal §4 cấm.
    const nhan = nhanNguoiSuKien(NGUOI_TU_DONG, new Map());
    expect(nhan).toBe('ghi qua đường tự động');
    expect(nhan).not.toContain('Hệ thống tự động');
  });

  it('dòng của người thật hiện TÊN, không hiện email', () => {
    const ten = new Map([['minhtu.event@gmail.com', 'Minh Tú']]);
    expect(nhanNguoiSuKien('minhtu.event@gmail.com', ten)).toBe('Minh Tú');
  });

  it('không tra được tên thì mới hiện email, và không ném', () => {
    expect(() => nhanNguoiSuKien('ai@do.com', new Map())).not.toThrow();
    expect(nhanNguoiSuKien('ai@do.com', new Map())).toBe('ai@do.com');
  });
});

describe('nhanNguoiBao', () => {
  it('người báo đã bị xoá khỏi user thì không ném, trả email rồi tới ẩn danh', () => {
    // `reporter_id` là `on delete set null`, nên tra tên có thể ra rỗng cho một báo lỗi cũ.
    expect(nhanNguoiBao({ ten: null, email: 'cu@gmail.com' })).toBe('cu@gmail.com');
    expect(nhanNguoiBao({ ten: null, email: null })).toBe('ẩn danh');
    expect(() => nhanNguoiBao({ ten: null, email: null })).not.toThrow();
  });

  it('có tên thì ưu tiên tên', () => {
    expect(nhanNguoiBao({ ten: 'Bá Đức', email: 'bduc13922@gmail.com' })).toBe('Bá Đức');
  });
});

describe('laLienKetAnToan', () => {
  it('prUrl không phải https thì không coi là liên kết an toàn', () => {
    for (const xau of ['javascript:alert(1)', 'http://x.com', 'data:text/html,x', '/noi-bo', '', null]) {
      expect(laLienKetAnToan(xau), String(xau)).toBe(false);
    }
  });

  it('chỉ https được qua', () => {
    expect(laLienKetAnToan('https://github.com/x/y/pull/1')).toBe(true);
  });
});

describe('cauChuaXuLy', () => {
  it('mỗi trạng thái chưa có ghi chú xử lý đều có câu riêng, không trả chuỗi rỗng', () => {
    const da = new Set<string>();
    for (const t of TRANG_THAI) {
      const cau = cauChuaXuLy(t.ma);
      expect(cau.length, t.ma).toBeGreaterThan(0);
      da.add(cau);
    }
    // Câu giống nhau cho mọi trạng thái thì ô đó không nói thêm gì so với chip trạng thái.
    expect(da.size).toBeGreaterThan(1);
  });

  it('trạng thái "moi" nói rõ tác vụ tự động chạy khi nào', () => {
    expect(cauChuaXuLy('moi')).toContain('1:41');
  });

  it('trạng thái lạ vẫn trả một câu, không ném', () => {
    expect(() => cauChuaXuLy('khong-ton-tai')).not.toThrow();
    expect(cauChuaXuLy('khong-ton-tai').length).toBeGreaterThan(0);
  });
});
