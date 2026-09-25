import { describe, it, expect } from 'vitest';
import { qcCheckLark, whActionLark, warehouseLark, dinhDanh, storeFinalLark } from './cot-lark';

describe('qcCheckLark', () => {
  /* Bốn tên này đọc thẳng từ cột chọn của Lark 25/09. Dịch lại cho đẹp là mất
   * khả năng đối chiếu: người xem so hai màn sẽ thấy "khác" ở mọi dòng. */
  it('khớp nguyên văn tên lựa chọn trên Lark', () => {
    expect(qcCheckLark('pending')).toBe('Tiếp nhận - chưa QC');
    expect(qcCheckLark('pass')).toBe('QC Pass');
    expect(qcCheckLark('fail')).toBe('QC Failed');
  });
  it('giá trị lạ rơi về "chưa QC", không ném giữa bảng', () => {
    expect(qcCheckLark('gi-do')).toBe('Tiếp nhận - chưa QC');
  });
});

describe('whActionLark', () => {
  /* Chưa gửi thì Lark KHÔNG có dòng nào — hiện " Chờ QC " là nói dối người
   * đang ngồi đối chiếu hai màn. */
  it('chưa gửi Lark → null, KHÔNG phải "Chờ QC"', () => {
    expect(whActionLark({ larkRecordId: null, ketQuaQc: 'pending' })).toBeNull();
  });
  it('đã gửi, chưa QC → " Chờ QC " giữ nguyên hai dấu cách', () => {
    expect(whActionLark({ larkRecordId: 'rec1', ketQuaQc: 'pending' })).toBe(' Chờ QC ');
  });
  it('QC đạt → "Tạm nhập (đi đơn)"', () => {
    expect(whActionLark({ larkRecordId: 'rec1', ketQuaQc: 'pass' })).toBe('Tạm nhập (đi đơn)');
  });
});

describe('warehouseLark', () => {
  it('đổi sang tên kho của Lark', () => {
    expect(warehouseLark('GVM')).toBe('HN | GVM');
    expect(warehouseLark('AP')).toBe('SG | AP');
  });
  it('mã lạ giữ nguyên, không bịa', () => {
    expect(warehouseLark('XYZ')).toBe('XYZ');
  });
});

describe('dinhDanh', () => {
  it('ghép đủ bốn phần y như công thức Lark', () => {
    expect(dinhDanh({ maDon: '#MBLVD30542', sku: 'TomFried-TS2644-S-KPTT-PLA', uniqueCode: 'WH-34061' }))
      .toBe('#MBLVD30542-TomFried-TS2644-S-KPTT-PLA-Retail-WH-34061');
  });

  /* Đây đúng chuỗi mà record thử 24/09 sinh ra lúc hai cột text còn trống —
   * công thức Lark LOẠI phần rỗng chứ không để lại dấu `-` thừa. */
  it('thiếu mã đơn và SKU → loại hẳn phần rỗng, không để "--"', () => {
    expect(dinhDanh({ maDon: null, sku: null, uniqueCode: 'WH-34061' })).toBe('Retail-WH-34061');
  });

  it('chưa gửi Lark (chưa có unique code) → bỏ phần cuối', () => {
    expect(dinhDanh({ maDon: '#MBLVD1', sku: 'S1', uniqueCode: null })).toBe('#MBLVD1-S1-Retail');
  });

  it('chuỗi toàn dấu cách cũng tính là rỗng', () => {
    expect(dinhDanh({ maDon: '  ', sku: 'S1', uniqueCode: null })).toBe('S1-Retail');
  });
});

describe('storeFinalLark', () => {
  /* Bảng map đo thẳng từ 9.083 dòng Lark 25/09, không phải suy đoán. */
  it('suy đúng store từ tiền tố mã đơn', () => {
    expect(storeFinalLark('#MBLVD30542')).toBe('#MBLVD');
    expect(storeFinalLark('TA2337')).toBe('#TINH');
    expect(storeFinalLark('#MIRER118')).toBe('#MIRER');
  });

  it('có hay không dấu # đều ra cùng kết quả', () => {
    expect(storeFinalLark('MBLVD30542')).toBe(storeFinalLark('#MBLVD30542'));
  });

  /* Gán sai store làm hỏng chính phép đối chiếu mà trang này sinh ra để làm. */
  it('tiền tố lạ trả null, KHÔNG đoán bừa', () => {
    expect(storeFinalLark('#ZZZ999')).toBeNull();
    expect(storeFinalLark('12345')).toBeNull();
    expect(storeFinalLark(null)).toBeNull();
    expect(storeFinalLark('')).toBeNull();
  });
});
