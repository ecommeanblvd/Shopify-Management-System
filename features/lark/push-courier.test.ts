import { describe, it, expect, vi } from 'vitest';
import { dongBoCourierLark, soDonTuRecord, COT_COURIER } from './push-courier';

const rec = (id: string, so: string, couriers?: unknown) => ({
  record_id: id,
  fields: { 'Order Number': [{ text: so, type: 'text' }], ...(couriers === undefined ? {} : { [COT_COURIER]: couriers }) },
});

describe('soDonTuRecord', () => {
  it('đọc được dạng rich-text và dạng chuỗi, bỏ dấu #', () => {
    expect(soDonTuRecord({ 'Order Number': [{ text: '#MBLVD1' }] })).toBe('MBLVD1');
    expect(soDonTuRecord({ 'Order Number': 'TA9' })).toBe('TA9');
  });
  it('thiếu trường → null', () => {
    expect(soDonTuRecord({})).toBeNull();
    expect(soDonTuRecord({ 'Order Number': [] })).toBeNull();
  });
});

describe('dongBoCourierLark', () => {
  it('ô TRỐNG → điền', async () => {
    const ghi = vi.fn().mockResolvedValue(undefined);
    const kq = await dongBoCourierLark(
      [{ soDon: '#MBLVD1', carrierKey: 'fedex' }],
      async () => [rec('r1', 'MBLVD1')],
      ghi,
    );
    expect(kq.daDien).toBe(1);
    expect(ghi).toHaveBeenCalledWith('r1', { [COT_COURIER]: 'FedEx' });
  });

  it('ô đã ĐÚNG → không ghi lại, khỏi làm phiền bảng vận hành', async () => {
    const ghi = vi.fn();
    const kq = await dongBoCourierLark(
      [{ soDon: 'MBLVD1', carrierKey: 'fedex' }],
      async () => [rec('r1', 'MBLVD1', 'FedEx')],
      ghi,
    );
    expect(kq.daDien).toBe(0);
    expect(ghi).not.toHaveBeenCalled();
  });

  it('ô đã có giá trị KHÁC → KHÔNG ghi đè, chỉ báo lệch (tôn trọng sửa tay của vận hành)', async () => {
    const ghi = vi.fn();
    const kq = await dongBoCourierLark(
      [{ soDon: 'MBLVD1', carrierKey: 'fedex' }],
      async () => [rec('r1', 'MBLVD1', 'DHL')],
      ghi,
    );
    expect(ghi).not.toHaveBeenCalled();
    expect(kq.lechKhongGhi).toEqual([{ soDon: 'MBLVD1', tenTrenLark: 'DHL', tenHeThong: 'FedEx' }]);
  });

  it('một đơn NHIỀU dòng Lark → điền hết, sót dòng nào là kiện đó đóng nhầm hãng', async () => {
    const ghi = vi.fn().mockResolvedValue(undefined);
    const kq = await dongBoCourierLark(
      [{ soDon: 'MBLVD1', carrierKey: 'dhl' }],
      async () => [rec('r1', 'MBLVD1'), rec('r2', 'MBLVD1'), rec('r3', 'KHAC')],
      ghi,
    );
    expect(kq.daDien).toBe(2);
    expect(ghi).toHaveBeenCalledTimes(2);
  });

  it('hãng chưa khai tên Lark → bỏ qua, không ghi gì', async () => {
    const ghi = vi.fn();
    const kq = await dongBoCourierLark([{ soDon: 'MBLVD1', carrierKey: 'gls' }], async () => [rec('r1', 'MBLVD1')], ghi);
    expect(kq.doiChieu).toBe(0);
    expect(ghi).not.toHaveBeenCalled();
  });

  it('không đơn nào chọn hãng → KHÔNG đọc Lark (khỏi tốn call)', async () => {
    const doc = vi.fn();
    await dongBoCourierLark([], doc, vi.fn());
    expect(doc).not.toHaveBeenCalled();
  });

  it('lỗi ghi một dòng không làm hỏng các dòng còn lại', async () => {
    const ghi = vi.fn()
      .mockRejectedValueOnce(new Error('lark 429'))
      .mockResolvedValueOnce(undefined);
    const kq = await dongBoCourierLark(
      [{ soDon: 'A', carrierKey: 'fedex' }, { soDon: 'B', carrierKey: 'dhl' }],
      async () => [rec('r1', 'A'), rec('r2', 'B')],
      ghi,
    );
    expect(kq.daDien).toBe(1);
    expect(kq.loi).toHaveLength(1);
  });
});
