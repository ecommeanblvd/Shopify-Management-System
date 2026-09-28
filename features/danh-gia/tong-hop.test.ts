import { describe, it, expect } from 'vitest';
import { gomTheoSao, gomTheoBrand, canChua, type DongDanhGia } from './tong-hop';

const d = (x: Partial<DongDanhGia> & { soSao: number }): DongDanhGia => ({
  id: Math.random().toString(36).slice(2), trangThai: null, vendor: null, ...x,
});

describe('gomTheoSao', () => {
  it('luôn trả đủ 5 mức, xếp từ 5 sao xuống', () => {
    const r = gomTheoSao([d({ soSao: 5 }), d({ soSao: 5 }), d({ soSao: 1 })]);
    expect(r).toEqual([
      { soSao: 5, soCa: 2 }, { soSao: 4, soCa: 0 }, { soSao: 3, soCa: 0 },
      { soSao: 2, soCa: 0 }, { soSao: 1, soCa: 1 },
    ]);
  });

  it('dựng lại đúng phân bố hai cực đo được — 22 ca 5 sao, 21 ca 1 sao, 0 ca 3 sao', () => {
    const ds = [
      ...Array.from({ length: 22 }, () => d({ soSao: 5 })),
      ...Array.from({ length: 21 }, () => d({ soSao: 1 })),
      d({ soSao: 4 }), d({ soSao: 2 }),
    ];
    const r = gomTheoSao(ds);
    expect(r.find((x) => x.soSao === 5)!.soCa).toBe(22);
    expect(r.find((x) => x.soSao === 1)!.soCa).toBe(21);
    // Chính khoảng trống này làm số sao trung bình vô nghĩa.
    expect(r.find((x) => x.soSao === 3)!.soCa).toBe(0);
  });

  it('bỏ qua số sao ngoài khoảng chứ không nổ', () => {
    expect(gomTheoSao([d({ soSao: 0 }), d({ soSao: 9 })])
      .every((x) => x.soCa === 0)).toBe(true);
  });

  it('rỗng vẫn trả đủ 5 mức', () => {
    expect(gomTheoSao([])).toHaveLength(5);
  });
});

describe('gomTheoBrand — một đánh giá đếm cho ĐÚNG một brand', () => {
  it('không đánh giá nào bị đếm hai lần', () => {
    const ds = [
      d({ soSao: 1, vendor: 'Happy Clothing' }),
      d({ soSao: 1, vendor: 'Happy Clothing' }),
      d({ soSao: 5, vendor: 'Happy Clothing' }),
      d({ soSao: 1, vendor: 'Đăng Phong Designer' }),
    ];
    const r = gomTheoBrand(ds);
    expect(r.reduce((a, x) => a + x.soCa, 0)).toBe(ds.length);
    expect(r[0]).toEqual({ brand: 'Happy Clothing', soCa: 3, soMotSao: 2, soSaoThap: 2 });
    expect(r[1]).toEqual({ brand: 'Đăng Phong Designer', soCa: 1, soMotSao: 1, soSaoThap: 1 });
  });

  it('xếp brand nhiều đánh giá 1 sao lên trước', () => {
    const r = gomTheoBrand([
      d({ soSao: 5, vendor: 'A' }), d({ soSao: 5, vendor: 'A' }), d({ soSao: 5, vendor: 'A' }),
      d({ soSao: 1, vendor: 'B' }),
    ]);
    expect(r.map((x) => x.brand)).toEqual(['B', 'A']);
  });

  it('đếm 1–2 sao vào soSaoThap, chỉ 1 sao vào soMotSao', () => {
    const r = gomTheoBrand([d({ soSao: 2, vendor: 'A' }), d({ soSao: 1, vendor: 'A' })]);
    expect(r[0]!.soMotSao).toBe(1);
    expect(r[0]!.soSaoThap).toBe(2);
  });

  it('GIỮ nhóm "(chưa rõ brand)" — bỏ nó là che mất đánh giá tệ không quy được về ai', () => {
    const r = gomTheoBrand([d({ soSao: 1 }), d({ soSao: 1, vendor: '   ' })]);
    expect(r).toEqual([{ brand: '(chưa rõ brand)', soCa: 2, soMotSao: 2, soSaoThap: 2 }]);
  });

  it('rỗng trả rỗng', () => {
    expect(gomTheoBrand([])).toEqual([]);
  });
});

describe('canChua', () => {
  it('lấy 1–2 sao chưa xử lý', () => {
    const ds = [
      d({ soSao: 1, trangThai: 'request_info' }),
      d({ soSao: 2, trangThai: null }),
      d({ soSao: 1, trangThai: 'responded' }),
      d({ soSao: 1, trangThai: 'archived' }),
      d({ soSao: 5, trangThai: null }),
    ];
    expect(canChua(ds)).toHaveLength(2);
  });

  it('trạng thái TRỐNG tính là CHƯA xử lý — 7/45 dòng Lark để trống', () => {
    expect(canChua([d({ soSao: 1, trangThai: null })])).toHaveLength(1);
  });

  it('đánh giá tốt không bao giờ vào danh sách cần chữa', () => {
    expect(canChua([d({ soSao: 4, trangThai: null }), d({ soSao: 5, trangThai: null })]))
      .toEqual([]);
  });
});
