import { describe, it, expect } from 'vitest';
import { LY_DO, lyDoHopLe, nhanLyDo, maRma, NOI_HOAN } from './ly-do';

describe('LY_DO', () => {
  /* Bộ lý do dựng từ 1.414 yêu cầu thật: gần 60% là "không vừa" và "đổi ý",
   * hàng lỗi chỉ 29 ca. Bộ cũ thiên về hàng lỗi nên CX sẽ chọn "other". */
  it('phủ đủ năm lý do chính đo được từ dữ liệu CX', () => {
    expect(LY_DO.map((l) => l.ma))
      .toEqual(['khong_vua', 'doi_y', 'khac_mo_ta', 'hang_loi', 'khac']);
  });
  it('lý do phổ biến nhất có đủ năm lý do phụ', () => {
    expect(LY_DO[0]!.phu).toHaveLength(5);
  });
  it('mã lý do phụ không trùng nhau trong cùng một nhóm', () => {
    for (const l of LY_DO) {
      expect(new Set(l.phu.map((p) => p.ma)).size).toBe(l.phu.length);
    }
  });
});

describe('lyDoHopLe', () => {
  it('lý do chính có thật, không kèm phụ → hợp lệ', () => {
    expect(lyDoHopLe('doi_y', null)).toBe(true);
    expect(lyDoHopLe('khong_vua', '')).toBe(true);
  });
  it('cặp chính + phụ đúng → hợp lệ', () => {
    expect(lyDoHopLe('khong_vua', 'size_quen')).toBe(true);
  });
  /* Lý do phụ của nhóm khác lọt sang là số liệu báo cáo sai ngay từ gốc. */
  it('lý do phụ KHÔNG thuộc nhóm đó → từ chối', () => {
    expect(lyDoHopLe('doi_y', 'size_quen')).toBe(false);
    expect(lyDoHopLe('khong_vua', 'khac_mau')).toBe(false);
  });
  it('lý do chính lạ → từ chối', () => {
    expect(lyDoHopLe('gi_do', null)).toBe(false);
  });
});

describe('nhanLyDo', () => {
  /* Giữ ĐÚNG dạng CX đang ghi trên Lark để đối chiếu ngược 1.414 dòng cũ. */
  it('ghép hai tầng đúng dạng Lark', () => {
    expect(nhanLyDo('khong_vua', 'size_quen')).toBe("Doesn't suit me (I ordered my usual size)");
  });
  it('không có lý do phụ thì chỉ hiện lý do chính', () => {
    expect(nhanLyDo('doi_y', null)).toBe('I change my mind');
  });
  it('mã lạ trả nguyên mã, không ném', () => {
    expect(nhanLyDo('gi_do', null)).toBe('gi_do');
  });
});

describe('maRma', () => {
  it('bỏ dấu # và viết hoa, đúng quy ước CX', () => {
    expect(maRma('#MBLVD30319')).toBe('RTMBLVD30319');
    expect(maRma('TA1861')).toBe('RTTA1861');
  });
  /* Một đơn trả nhiều món ở hai lần khác nhau thì mã phải khác — 224/1.096 đơn
   * bên Lark có nhiều hơn một dòng trả. */
  it('lần thứ hai trở đi thêm hậu tố', () => {
    expect(maRma('TA1861', 2)).toBe('RTTA1861-2');
    expect(maRma('TA1861', 1)).toBe('RTTA1861');
  });
});

describe('NOI_HOAN', () => {
  /* 93% yêu cầu hoàn về store credit — thiếu trường này là mất thông tin quan
   * trọng nhất của khâu hoàn tiền. */
  it('có đúng hai nơi hoàn mà CX dùng', () => {
    expect(NOI_HOAN.map((x) => x.ma)).toEqual(['store_credit', 'original_payment']);
  });
});
