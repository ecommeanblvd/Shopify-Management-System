import { describe, it, expect } from 'vitest';
import {
  dungPayloadNhan, dungPayloadSauQcDat, dungPayloadSauQcKhongDat,
  WH_ACTION_CHO_QC, WH_ACTION_TAM_NHAP, INVENTORY_TYPE_RETAIL,
} from './wh-lark-payload';

describe('giá trị cột chọn phải khớp NGUYÊN VĂN tên lựa chọn trên Lark', () => {
  it('"Chờ QC" có dấu cách CẢ HAI ĐẦU — trim là đẻ lựa chọn mới trên bảng vận hành', () => {
    expect(WH_ACTION_CHO_QC).toBe(' Chờ QC ');
    expect(WH_ACTION_CHO_QC).toHaveLength(8);
    expect(WH_ACTION_CHO_QC.trim()).not.toBe(WH_ACTION_CHO_QC);
  });
  it('"Tạm nhập (đi đơn)" KHÔNG có dấu cách thừa', () => {
    expect(WH_ACTION_TAM_NHAP).toBe('Tạm nhập (đi đơn)');
    expect(WH_ACTION_TAM_NHAP).toHaveLength(17);
  });
  it('inventory type là "Retail"', () => {
    expect(INVENTORY_TYPE_RETAIL).toBe('Retail');
  });
});

describe('dungPayloadNhan', () => {
  const luc = new Date('2026-09-24T10:00:00Z');

  it('đủ mười một cột, không thừa cột nào', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'recABC', maDon: '#MBLVD30542', sku: 'TomFried-TS2644-S-KPTT-PLA', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'GVM' });
    expect(Object.keys(p).sort()).toEqual([
      'Import (select order)', 'Import - Inventory type', 'Lineitem Name',
      'Lineitem SKU final', 'Ngày Import - tiếp nhận đồ tại kho',
      'Order Number final', 'QC Check', 'Quantity tiếp nhận trước QC',
      'Store final', 'WH - Action', 'Warehouse',
    ]);
  });

  it('cột liên kết nhận MẢNG record_id, không phải chuỗi', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'recABC', maDon: '#MBLVD30542', sku: 'TomFried-TS2644-S-KPTT-PLA', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'GVM' });
    expect(p['Import (select order)']).toEqual(['recABC']);
  });

  it('ngày ghi bằng mốc thời gian epoch, đúng kiểu date của Lark', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'GVM' });
    expect(p['Ngày Import - tiếp nhận đồ tại kho']).toBe(luc.getTime());
  });

  it('lúc NHẬN là "Chờ QC", KHÔNG phải "Tạm nhập" — hàng chưa kiểm thì chưa nhập kho', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'GVM' });
    expect(p['WH - Action']).toBe(' Chờ QC ');
  });

  /* Cột `… (look up)` Lark tự sinh từ liên kết — điền tay vào là Lark từ chối.
   * Khác hẳn cột `… final`, vốn là Text và PHẢI điền (xem nhóm test cuối file). */
  it('KHÔNG điền tay các cột Lark tự lookup', () => {
    const p = dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'GVM' });
    for (const k of ['Lineitem SKU (look up)', 'Order number (look up)', 'Brand', 'Định danh', 'WH - Unique code (k xóa)']) {
      expect(p).not.toHaveProperty(k);
    }
  });
});

describe('dungPayloadSauQcDat', () => {
  it('đổi ĐÚNG hai cột kết quả, không đụng ngày hay liên kết', () => {
    expect(dungPayloadSauQcDat()).toEqual({
      'WH - Action': 'Tạm nhập (đi đơn)', 'QC Check': 'QC Pass',
    });
  });
});

describe('dungPayloadSauQcKhongDat', () => {
  /* Đội kho điền QC Check 100% (1.390/1.390 dòng từ 01/08) và đang có 131 dòng
   * QC Failed. Không ghi cột này là dòng của mình thủng đúng con số đó. */
  it('ghi QC Check = QC Failed', () => {
    expect(dungPayloadSauQcKhongDat()['QC Check']).toBe('QC Failed');
  });

  /* "Gửi trả Vendor (QC fail)" mang nghĩa ĐÃ GỬI TRẢ. QC hỏng chưa chắc đã gửi
   * trả ngay, đặt hộ là báo sai một việc chưa ai làm. */
  it('KHÔNG đụng WH - Action — việc gửi trả để kho tự chọn', () => {
    expect(dungPayloadSauQcKhongDat()).not.toHaveProperty('WH - Action');
  });
});


describe('cột Warehouse — thiếu là record VÔ HÌNH trên mọi view', () => {
  const luc = new Date('2026-09-24T10:00:00Z');
  it('ba kho của hệ thống map đúng tên lựa chọn trên Lark', () => {
    expect(dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'GVM' }).Warehouse).toBe('HN | GVM');
    expect(dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'AP' }).Warehouse).toBe('SG | AP');
    expect(dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'DM' }).Warehouse).toBe('SG | DM');
  });
  it('kho lạ thì NÉM, không ghi record vô hình', () => {
    expect(() => dungPayloadNhan({ larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'SKU-1', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'XYZ' })).toThrow();
  });
});

describe('hai cột nuôi công thức Định danh', () => {
  const luc = new Date('2026-09-24T03:00:00Z');
  /* `Định danh` ghép Order Number final + Lineitem SKU final + Inventory type +
   * Unique code. Bỏ trống hai cột đầu thì nó ra `Retail-WH-34061` cụt ngủn —
   * đúng lỗi của record thử 24/09. Lark KHÔNG tự chép từ cột look up sang. */
  it('điền cả mã đơn lẫn SKU, nguyên văn', () => {
    const p = dungPayloadNhan({
      larkMonRecordId: 'rec1', maDon: '#MBLVD30542',
      sku: 'TomFried-TS2644-S-KPTT-PLA', store: '#MBLVD', tenMon: 'Eiren Lace Maxi Dress - 3XL',
      nhanLuc: luc, kho: 'GVM',
    });
    expect(p['Order Number final']).toBe('#MBLVD30542');
    expect(p['Lineitem SKU final']).toBe('TomFried-TS2644-S-KPTT-PLA');
  });

  it('không tự thêm/bớt dấu # — giữ đúng thứ bảng liên kết đang có', () => {
    const p = dungPayloadNhan({
      larkMonRecordId: 'rec1', maDon: 'TA2337', sku: 'S', store: '#MBLVD', tenMon: 'Ao dai - S', nhanLuc: luc, kho: 'GVM',
    });
    expect(p['Order Number final']).toBe('TA2337');
  });
});

describe('QC Check lúc TẠO', () => {
  /* Để trống là dòng của mình rơi ra ngoài mọi bộ lọc theo QC Check mà đội kho
   * đang dùng — họ điền cột này 100%. */
  it('tạo dòng là điền luôn "Tiếp nhận - chưa QC"', () => {
    const p = dungPayloadNhan({
      larkMonRecordId: 'r', maDon: '#MBLVD1', sku: 'S1', store: '#MBLVD', tenMon: 'X',
      nhanLuc: new Date('2026-09-25T03:00:00Z'), kho: 'GVM',
    });
    expect(p['QC Check']).toBe('Tiếp nhận - chưa QC');
  });
});

describe('ba cột đội kho báo trống 25/09', () => {
  const luc = new Date('2026-09-25T03:00:00Z');
  const co = (t: Partial<Parameters<typeof dungPayloadNhan>[0]> = {}) => dungPayloadNhan({
    larkMonRecordId: 'r', maDon: '#MBLVD30465', sku: 'S1',
    store: '#MBLVD', tenMon: 'Eiren Lace Maxi Dress - 3XL', nhanLuc: luc, kho: 'GVM', ...t,
  });

  /* Ba cột này là NHẬP TAY trên Lark, không phải lookup — chọn xong
   * "Import (select order)" cũng không tự đầy. */
  it('điền Store final, Lineitem Name và Quantity', () => {
    const p = co();
    expect(p['Store final']).toBe('#MBLVD');
    expect(p['Lineitem Name']).toBe('Eiren Lace Maxi Dress - 3XL');
    expect(p['Quantity tiếp nhận trước QC']).toBe(1);
  });

  /* Ghi giá trị lạ vào cột CHỌN thì Lark đẻ thêm lựa chọn mới trên bảng vận
   * hành chứ không báo lỗi — hỏng bộ lọc của cả đội (D-045). */
  it('store lạ thì BỎ TRỐNG cột, không đẻ lựa chọn mới', () => {
    expect(co({ store: 'Shop nao do' })).not.toHaveProperty('Store final');
    expect(co({ store: null })).not.toHaveProperty('Store final');
  });

  it('tên món trống thì bỏ cột, không ghi chuỗi rỗng', () => {
    expect(co({ tenMon: '   ' })).not.toHaveProperty('Lineitem Name');
  });
});

describe('dấu # của Order Number final', () => {
  const luc = new Date('2026-09-25T03:00:00Z');
  /* Đội kho báo 25/09: mã thiếu `#` so với mọi dòng khác. Nguyên nhân là lấy
   * từ `lark_mon_don`, nơi mình đã strip sạch `#` (0/7752 dòng còn dấu). */
  it('giữ NGUYÊN VĂN số đơn truyền vào, không thêm không bớt', () => {
    const goi = (maDon: string) => dungPayloadNhan({
      larkMonRecordId: 'r', maDon, sku: 'S1', store: null, tenMon: null, nhanLuc: luc, kho: 'GVM',
    })['Order Number final'];
    expect(goi('#MBLVD30465')).toBe('#MBLVD30465');
    // TINH không dùng `#` (1.320/1.340 đơn) — tự thêm vào là sai cả store đó.
    expect(goi('TA2337')).toBe('TA2337');
  });
});
