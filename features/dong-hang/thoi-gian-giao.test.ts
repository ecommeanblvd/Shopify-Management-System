import { describe, it, expect } from 'vitest';
import { chonSoLieu, TOI_THIEU_KIEN } from './thoi-gian-giao';

describe('chonSoLieu', () => {
  it('đủ kiện theo nước → lấy số liệu của nước đó', () => {
    const r = chonSoLieu(
      [{ carrierKey: 'aramex', soKien: 36, ngayTb: 3.2 }],
      [{ carrierKey: 'aramex', soKien: 67, ngayTb: 3.8 }],
    );
    expect(r.aramex).toEqual({ ngayTb: 3.2, soKien: 36, phamVi: 'nuoc' });
  });

  it('ít kiện theo nước → lùi về số liệu chung, nói rõ phạm vi', () => {
    const r = chonSoLieu(
      [{ carrierKey: 'ups', soKien: 2, ngayTb: 9 }],
      [{ carrierKey: 'ups', soKien: 21, ngayTb: 5.2 }],
    );
    expect(r.ups).toEqual({ ngayTb: 5.2, soKien: 21, phamVi: 'chung' });
  });

  it('hãng chưa từng giao kiện nào thì không có số liệu', () => {
    expect(chonSoLieu([], [])).toEqual({});
    expect(chonSoLieu([{ carrierKey: 'dhl', soKien: 1, ngayTb: 4 }], [])).toEqual({});
  });

  it('ngưỡng tối thiểu áp đúng ở biên', () => {
    const bien = [{ carrierKey: 'fedex', soKien: TOI_THIEU_KIEN, ngayTb: 4.2 }];
    expect(chonSoLieu(bien, [{ carrierKey: 'fedex', soKien: 387, ngayTb: 4.8 }]).fedex.phamVi).toBe('nuoc');
    const duoiBien = [{ carrierKey: 'fedex', soKien: TOI_THIEU_KIEN - 1, ngayTb: 4.2 }];
    expect(chonSoLieu(duoiBien, [{ carrierKey: 'fedex', soKien: 387, ngayTb: 4.8 }]).fedex.phamVi).toBe('chung');
  });
});
