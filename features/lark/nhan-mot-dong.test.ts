import { describe, it, expect } from 'vitest';
import { docKetQuaPhanLoai } from './nhan-mot-dong';
import type { ClassifyResult } from './classify';
import type { PackRow } from './parse-pack-row';

const row: PackRow = { orderNumber: '#MBLVD1', logUniqueCode: 'PK-1', weightKg: 1, dims: null, trackingNumber: null,
  carrierKey: null, labelDate: null, base: null, ngayDiDuKien: null, hop: null, hopRecordId: null, skuText: null, pieces: null, warnings: [] };
const trong = (): ClassifyResult => ({ update: [], create: [], unmatched: [], skipped: [] });

describe('docKetQuaPhanLoai', () => {
  it('update → cap_nhat với shipmentId', () => {
    const c = trong(); c.update.push({ row, shipmentId: 's1' });
    expect(docKetQuaPhanLoai(c)).toEqual({ loai: 'update', shipmentId: 's1' });
  });
  it('create → tao với orderId', () => {
    const c = trong(); c.create.push({ row, orderId: 'o1' });
    expect(docKetQuaPhanLoai(c)).toEqual({ loai: 'create', orderId: 'o1' });
  });
  it('unmatched → khong_khop kèm lý do', () => {
    const c = trong(); c.unmatched.push({ orderNumber: '#MBLVD1', reason: 'order chưa có trong hệ thống' });
    expect(docKetQuaPhanLoai(c)).toEqual({ loai: 'unmatched', lyDo: 'order chưa có trong hệ thống' });
  });
  it('skipped → bo_qua kèm lý do; rỗng → bo_qua', () => {
    const c = trong(); c.skipped.push({ orderNumber: 'DISCN5', reason: 'DISCN partner ship' });
    expect(docKetQuaPhanLoai(c)).toEqual({ loai: 'skipped', lyDo: 'DISCN partner ship' });
    expect(docKetQuaPhanLoai(trong())).toEqual({ loai: 'skipped', lyDo: 'không phân loại được' });
  });
});
