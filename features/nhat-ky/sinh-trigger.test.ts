import { describe, it, expect } from 'vitest';
import { CAU_HINH } from './cot-theo-doi';
import { sinhTrigger, sinhGoTrigger } from './sinh-trigger';

describe('sinhTrigger', () => {
  it('sinh CREATE TRIGGER truyền danh sách cột làm đối số', () => {
    const sql = sinhTrigger(
      { bang: 'goods_receipt_items', cheDo: 'tru', cot: ['updated_at'], cotCha: 'receipt_id', bangCha: 'goods_receipts' },
      ['id', 'qc_result', 'updated_at'],
    );
    expect(sql).toContain('CREATE TRIGGER nhat_ky_goods_receipt_items');
    expect(sql).toContain('AFTER INSERT OR UPDATE OR DELETE ON goods_receipt_items');
    expect(sql).toContain('FOR EACH ROW EXECUTE FUNCTION nhat_ky_ghi(');
    expect(sql).toContain("'id,qc_result'");
    expect(sql).toContain("'receipt_id'");
    expect(sql).toContain("'goods_receipts'");
    expect(sql).not.toContain('updated_at');
  });

  it('bảng không có cha truyền chuỗi rỗng cho hai đối số cuối', () => {
    const sql = sinhTrigger({ bang: 'shipments', cheDo: 'tru', cot: [] }, ['id', 'tracking_number']);
    expect(sql).toContain("'id,tracking_number', '', ''");
  });

  // Review Focus #4 — ghim ở tầng sinh SQL: cột loại trừ không bao giờ vào đối số,
  // nên trigger không có cách nào sinh dòng cho nó.
  it('cột loại trừ KHÔNG lọt vào đối số trigger', () => {
    const sql = sinhTrigger(
      { bang: 'shipments', cheDo: 'tru', cot: ['updated_at', 'last_tracked_at'] },
      ['id', 'tracking_number', 'updated_at', 'last_tracked_at'],
    );
    expect(sql).toContain("'id,tracking_number'");
    expect(sql).not.toContain('last_tracked_at');
  });

  it('chế độ cho-phép chỉ đưa cột trong danh sách vào đối số', () => {
    const sql = sinhTrigger(
      { bang: 'shopify_orders', cheDo: 'cho-phep', cot: ['selected_carrier_key'] },
      ['id', 'raw_payload', 'selected_carrier_key'],
    );
    expect(sql).toContain("'selected_carrier_key', '', ''");
    expect(sql).not.toContain('raw_payload');
  });

  it('cột mới của bảng chế độ trừ tự vào đối số', () => {
    const sql = sinhTrigger({ bang: 'shipments', cheDo: 'tru', cot: ['updated_at'] }, ['id', 'cot_moi_them', 'updated_at']);
    expect(sql).toContain("'id,cot_moi_them'");
  });

  it('tên bảng lạ bị từ chối, không nối thẳng vào SQL', () => {
    expect(() => sinhTrigger({ bang: 'x"; DROP TABLE y; --', cheDo: 'tru', cot: [] }, ['id'])).toThrow();
  });

  // Tên cột đi vào chuỗi đối số trong dấu nháy đơn: một dấu nháy là đủ thoát khỏi chuỗi.
  it('tên cột lạ bị từ chối, không lọt vào chuỗi đối số', () => {
    for (const xau of ["x'); DROP TABLE y; --", 'a,b', 'Hoa', '1abc', '', 'a b', 'a\n']) {
      expect(() => sinhTrigger({ bang: 'shipments', cheDo: 'tru', cot: [] }, ['id', xau])).toThrow();
    }
  });

  it('cột lạ nằm trong danh sách loại trừ thì không vào SQL nên không cần chặn', () => {
    const sql = sinhTrigger({ bang: 'shipments', cheDo: 'tru', cot: ["lạ'"] }, ['id', "lạ'"]);
    expect(sql).toContain("'id'");
  });

  it('tên bảng cha / cột cha lạ bị từ chối', () => {
    expect(() =>
      sinhTrigger({ bang: 'a', cheDo: 'tru', cot: [], cotCha: "x'", bangCha: 'b' }, ['id']),
    ).toThrow();
    expect(() =>
      sinhTrigger({ bang: 'a', cheDo: 'tru', cot: [], cotCha: 'x', bangCha: "b'; --" }, ['id']),
    ).toThrow();
  });

  it('khai cha thiếu một nửa thì từ chối thay vì lặng lẽ ghi sai', () => {
    expect(() => sinhTrigger({ bang: 'a', cheDo: 'tru', cot: [], cotCha: 'x' }, ['id'])).toThrow();
    expect(() => sinhTrigger({ bang: 'a', cheDo: 'tru', cot: [], bangCha: 'b' }, ['id'])).toThrow();
  });

  // Trigger không cột nào để so sẽ im lặng không ghi gì — tệ hơn là chết to lúc áp.
  it('không còn cột nào để theo dõi thì từ chối', () => {
    expect(() => sinhTrigger({ bang: 'shopify_orders', cheDo: 'cho-phep', cot: ['da_doi_ten'] }, ['id'])).toThrow();
  });

  it('mọi bảng trong CAU_HINH sinh được SQL hợp lệ', () => {
    for (const ch of CAU_HINH) {
      const sql = sinhTrigger(ch, ['id', ...ch.cot, ...(ch.cotCha ? [ch.cotCha] : [])]);
      expect(sql).toContain(`CREATE TRIGGER nhat_ky_${ch.bang}`);
      expect(sql).toContain(`ON ${ch.bang}`);
    }
  });
});

describe('sinhGoTrigger', () => {
  it('sinh lệnh gỡ dùng IF EXISTS để chạy lại không hỏng', () => {
    expect(sinhGoTrigger('shipments')).toBe('DROP TRIGGER IF EXISTS nhat_ky_shipments ON shipments;');
  });

  it('tên bảng lạ bị từ chối', () => {
    expect(() => sinhGoTrigger('x; DROP TABLE y')).toThrow();
  });
});
