import { describe, it, expect } from 'vitest';
import { patchGiaUocTinh } from './patch-gia-uoc-tinh';
import { COT_CHI_PHI, COT } from './cot';
import type { GiaUocTinh } from '@/features/dong-hang/gia-uoc-tinh';

describe('patchGiaUocTinh', () => {
  const g = {
    nguon: 'bang-gia', base: 100, fuel: 20, remote: null, demand: null,
    signature: null, residential: null, importHandling: null, vat: 10, total: 130,
  } as GiaUocTinh;

  it('ô trống thì điền', () => {
    expect(patchGiaUocTinh(g, {}, null)[COT_CHI_PHI.base]).toBe(100);
  });
  /* Anti-goal của spec: không bao giờ đè số người gõ tay. */
  it('ô ĐÃ CÓ số thì KHÔNG đụng', () => {
    const p = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: 999 }, null);
    expect(COT_CHI_PHI.base in p).toBe(false);
  });
  it('ô có số 0 cũng là ĐÃ CÓ, không đè', () => {
    const p = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: 0 }, null);
    expect(COT_CHI_PHI.base in p).toBe(false);
  });
  /* Review Focus #3: khoản null = KHÔNG BIẾT → không được ghi 0 vào ô. */
  it('khoản null thì bỏ hẳn khỏi patch, không ghi 0', () => {
    const p = patchGiaUocTinh(g, {}, null);
    expect(COT_CHI_PHI.remote in p).toBe(false);
  });
  it('ghi mã vận đơn khi ô trống', () => {
    expect(patchGiaUocTinh(g, {}, 'T1')[COT.trackingNumber]).toBe('T1');
  });
  it('Lark đã có mã vận đơn KHÁC thì không đè', () => {
    const p = patchGiaUocTinh(g, { [COT.trackingNumber]: 'T-CU' }, 'T-MOI');
    expect(COT.trackingNumber in p).toBe(false);
  });
  it('không có gì để ghi thì patch rỗng', () => {
    expect(Object.keys(patchGiaUocTinh(g, { [COT_CHI_PHI.base]: 1, [COT_CHI_PHI.fuel]: 1, [COT_CHI_PHI.vat]: 1 }, null))).toEqual([]);
  });
});
