import { describe, it, expect } from 'vitest';
import { tinhDongDieuChinh, docAnhChup, docDongDieuChinh } from './dieu-chinh';

const d = (code: string, amountVnd: number) => ({ code, amountVnd });

describe('tinhDongDieuChinh', () => {
  it('không đổi gì → KHÔNG dòng nào, không đẻ bảng kê điều chỉnh rỗng', () => {
    const r = tinhDongDieuChinh([d('A', 100), d('B', 200)], [d('A', 100), d('B', 200)]);
    expect(r).toEqual({ dong: [], tongDelta: 0 });
  });

  it('giá đổi → loại "sua", delta có dấu', () => {
    const r = tinhDongDieuChinh([d('A', 1_000_000)], [d('A', 800_000)]);
    expect(r.dong).toEqual([{ code: 'A', loai: 'sua', truoc: 1_000_000, sau: 800_000, delta: -200_000 }]);
    expect(r.tongDelta).toBe(-200_000);
  });

  /* Một đơn GIẢM 100k khác hẳn một đơn BỊ BỎ 100k dù delta bằng nhau: cái đầu là sửa giá, cái
     sau là trả lại brand toàn bộ. Gộp thành "chênh lệch" là mất đúng phần brand cần đối chiếu. */
  it('đơn bị gỡ khỏi kỳ → loại "bo", trả lại TOÀN BỘ, phân biệt với "sua"', () => {
    const bo = tinhDongDieuChinh([d('A', 100_000)], []);
    expect(bo.dong).toEqual([{ code: 'A', loai: 'bo', truoc: 100_000, sau: 0, delta: -100_000 }]);
    const sua = tinhDongDieuChinh([d('A', 200_000)], [d('A', 100_000)]);
    expect(sua.dong[0]!.loai).toBe('sua');
    expect(sua.dong[0]!.delta).toBe(bo.dong[0]!.delta);
  });

  it('đơn mới thuộc kỳ đã khoá → loại "them", thu thêm', () => {
    const r = tinhDongDieuChinh([], [d('A', 50_000)]);
    expect(r.dong).toEqual([{ code: 'A', loai: 'them', truoc: 0, sau: 50_000, delta: 50_000 }]);
  });

  /* Ảnh chụp lưu số ĐÃ làm tròn (payload MMP dùng Math.round), giá hiện tại là numeric có phần
     thập phân. So thẳng thì mỗi đơn lệch vài hào và CẢ KỲ thành điều chỉnh — 75 dòng rác. */
  it('lệch dưới một đồng → KHÔNG tính là điều chỉnh', () => {
    expect(tinhDongDieuChinh([d('A', 1_000_000)], [d('A', 1_000_000.4)]).dong).toEqual([]);
    expect(tinhDongDieuChinh([d('A', 1_000_000)], [d('A', 999_999.6)]).dong).toEqual([]);
  });

  it('ba loại cùng lúc, thứ tự ỔN ĐỊNH theo mã đơn', () => {
    const r = tinhDongDieuChinh(
      [d('C', 300), d('A', 100), d('B', 200)],
      [d('A', 150), d('C', 300), d('D', 400)],
    );
    expect(r.dong.map((x) => [x.code, x.loai])).toEqual([['A', 'sua'], ['B', 'bo'], ['D', 'them']]);
    expect(r.tongDelta).toBe(50 - 200 + 400);
  });
});

describe('docAnhChup', () => {
  it('đọc từ payload đã gửi MMP (có khoá orders)', () => {
    expect(docAnhChup({ orders: [{ code: 'A', amountVnd: 100 }], totalVnd: 100 }))
      .toEqual([{ code: 'A', amountVnd: 100 }]);
  });

  /* Bảng kê phát hành TRƯỚC migration 0190 không có ảnh chụp. Phải trả null để người gọi báo
     RIÊNG "thiếu ảnh chụp" — coi nó là "không có hiệu" là báo an toàn giả. */
  it('chưa có ảnh chụp → null, KHÔNG phải mảng rỗng', () => {
    expect(docAnhChup(null)).toBeNull();
    expect(docAnhChup(undefined)).toBeNull();
    expect(docAnhChup({ totalVnd: 100 })).toBeNull();
  });

  it('bỏ dòng rác, giữ dòng đọc được', () => {
    expect(docAnhChup({ orders: [{ code: 'A', amountVnd: 100 }, { code: 'B' }, { amountVnd: 5 }] }))
      .toEqual([{ code: 'A', amountVnd: 100 }]);
  });
});

describe('docDongDieuChinh', () => {
  it('đọc lại đúng dòng đã ghi', () => {
    const dong = [{ code: 'A', loai: 'sua' as const, truoc: 200, sau: 100, delta: -100 }];
    expect(docDongDieuChinh({ dong, tongDelta: -100 })).toEqual(dong);
  });

  it('loại lạ bị bỏ — không gửi MMP một loại nó không hiểu', () => {
    expect(docDongDieuChinh({ dong: [{ code: 'A', loai: 'huy', truoc: 1, sau: 0, delta: -1 }] })).toEqual([]);
  });

  it('không đọc được → null để người gọi KHÔNG GỬI (gửi rỗng là xoá sổ bên MMP)', () => {
    expect(docDongDieuChinh(null)).toBeNull();
    expect(docDongDieuChinh({ tongDelta: 0 })).toBeNull();
  });
});
