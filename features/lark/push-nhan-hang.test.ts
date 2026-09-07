import { describe, it, expect, vi } from 'vitest';
import { dongBoNhanHangLark, dungFieldsNhanHang, khoaNhanHang, COT_MA_MON, COT_NGAY_NHAN, COT_SKU, COT_SO_DON, COT_VENDOR } from './push-nhan-hang';

const d = (maMon: string[] = ['WH-00000001', 'WH-00000002']) => ({
  orderNumber: 'TA2331', sku: 'AO-X-XL', vendor: 'TINH', receivedAt: new Date('2026-09-06T03:00:00Z'), maMon,
});
const rec = (id: string, so: string, sku: string, extra: Record<string, unknown> = {}) => ({
  record_id: id, fields: { [COT_SO_DON]: so, [COT_SKU]: sku, ...extra },
});

describe('dungFieldsNhanHang', () => {
  it('đủ 5 cột; ngày là epoch ms; Mã món nối bằng " | "', () => {
    expect(dungFieldsNhanHang(d())).toEqual({
      [COT_SO_DON]: 'TA2331', [COT_SKU]: 'AO-X-XL', [COT_VENDOR]: 'TINH',
      [COT_NGAY_NHAN]: Date.parse('2026-09-06T03:00:00Z'), [COT_MA_MON]: 'WH-00000001 | WH-00000002',
    });
  });
});

describe('dongBoNhanHangLark', () => {
  it('chưa có dòng → tạo mới', async () => {
    const tao = vi.fn().mockResolvedValue('r-new'); const sua = vi.fn();
    const kq = await dongBoNhanHangLark([d()], async () => [], tao, sua);
    expect(kq).toEqual({ doiChieu: 1, daTao: 1, daDien: 0, boQua: 0, loi: [], loiKhoa: [] });
    expect(tao).toHaveBeenCalledWith(dungFieldsNhanHang(d()));
    expect(sua).not.toHaveBeenCalled();
  });
  it('đã có dòng, Mã món trống, đã có ngày → chỉ điền Mã món (không đụng ngày ops đã ghi)', async () => {
    const tao = vi.fn(); const sua = vi.fn().mockResolvedValue(undefined);
    const kq = await dongBoNhanHangLark([d()], async () => [rec('r1', '#TA2331', 'AO-X-XL', { [COT_NGAY_NHAN]: 1 })], tao, sua);
    expect(kq.daDien).toBe(1); expect(kq.daTao).toBe(0); expect(kq.boQua).toBe(0);
    expect(sua).toHaveBeenCalledWith('r1', { [COT_MA_MON]: 'WH-00000001 | WH-00000002' });
  });
  it('đã có dòng, đã có Mã món, ngày trống → chỉ điền ngày', async () => {
    const tao = vi.fn(); const sua = vi.fn().mockResolvedValue(undefined);
    const kq = await dongBoNhanHangLark([d()], async () => [rec('r1', 'TA2331', 'AO-X-XL', { [COT_MA_MON]: 'WH-00000009' })], tao, sua);
    expect(kq.daDien).toBe(1); expect(kq.boQua).toBe(0);
    expect(sua).toHaveBeenCalledWith('r1', { [COT_NGAY_NHAN]: Date.parse('2026-09-06T03:00:00Z') });
  });
  it('đã có dòng, cả Mã món và ngày đều có → bỏ qua, KHÔNG ghi đè, KHÔNG gọi sua', async () => {
    const tao = vi.fn(); const sua = vi.fn();
    const kq = await dongBoNhanHangLark([d()], async () => [rec('r1', 'TA2331', 'AO-X-XL', { [COT_MA_MON]: 'WH-00000009', [COT_NGAY_NHAN]: 1 })], tao, sua);
    expect(kq.boQua).toBe(1); expect(sua).not.toHaveBeenCalled(); expect(tao).not.toHaveBeenCalled();
  });
  it('khớp order bỏ dấu # và trim, đọc được order_number dạng rich-text', async () => {
    const tao = vi.fn(); const sua = vi.fn().mockResolvedValue(undefined);
    await dongBoNhanHangLark([d()], async () => [rec('r1', ' #TA2331 ', 'AO-X-XL'), { record_id: 'r2', fields: { [COT_SO_DON]: [{ text: 'TA2331' }], [COT_SKU]: [{ text: 'AO-X-XL' }] } }], tao, sua);
    expect(sua).toHaveBeenCalledTimes(2);
  });
  it('Lark ném lỗi → ghi vào loi, không ném ra ngoài', async () => {
    const tao = vi.fn().mockRejectedValue(new Error('403')); const sua = vi.fn();
    const kq = await dongBoNhanHangLark([d()], async () => [], tao, sua);
    expect(kq.loi).toEqual(['TA2331 AO-X-XL: 403']); expect(kq.daTao).toBe(0);
    expect(kq.loiKhoa).toEqual(['TA2331 AO-X-XL']);
  });
  it('SKU chứa \':\' → loiKhoa giữ nguyên khoá (không bị cắt bởi split trên loi)', async () => {
    const tao = vi.fn().mockRejectedValue(new Error('403')); const sua = vi.fn();
    const kq = await dongBoNhanHangLark([{ ...d(['WH-1']), sku: 'AO:X:XL' }], async () => [], tao, sua);
    expect(kq.loiKhoa).toEqual(['TA2331 AO:X:XL']);
    expect(kq.loi[0]).toMatch(/^TA2331 AO:X:XL: /);
  });
  it('dòng thiếu sku → không gọi taoRecord, rơi vào loiKhoa', async () => {
    const tao = vi.fn(); const sua = vi.fn();
    const kq = await dongBoNhanHangLark([{ ...d(), sku: '' }], async () => [], tao, sua);
    expect(tao).not.toHaveBeenCalled();
    expect(kq.loiKhoa).toEqual(['TA2331 ']);
    expect(kq.loi[0]).toBe('TA2331 : thiếu order hoặc sku');
  });
});

describe('khoaNhanHang', () => {
  it('trim khoảng trắng và bỏ dấu # ở order', () => {
    expect(khoaNhanHang('#TA2331 ', ' AO-X ')).toBe('TA2331 AO-X');
  });
  it('thiếu sku → null', () => {
    expect(khoaNhanHang('TA1', null)).toBeNull();
  });
  it('order rỗng → null', () => {
    expect(khoaNhanHang('', 'X')).toBeNull();
  });
});
