import { describe, it, expect } from 'vitest';
import { deriveTxnFee, type ShopifyTxn } from './derive-txn-fee';

const tx = (o: Partial<ShopifyTxn> & { fees?: ShopifyTxn['fees'] }): ShopifyTxn => ({
  kind: 'SALE', status: 'SUCCESS',
  amountSet: { shopMoney: { amount: '100', currencyCode: 'USD' } },
  fees: [], ...o,
});
const fee = (amount: string, currencyCode: string, rate: string, type: string, flat = '0') =>
  ({ amount: { amount, currencyCode }, rate, type, flatFee: { amount: flat } });

describe('deriveTxnFee', () => {
  it('phí cùng đồng đơn (USD): cộng thẳng tổng phí', () => {
    const r = deriveTxnFee([tx({
      amountSet: { shopMoney: { amount: '370.80', currencyCode: 'USD' } },
      fees: [fee('8.64', 'USD', '0.0225', 'processing_fee', '0.3')],
    })], 'USD');
    expect(r.feeOrderCcy).toBeCloseTo(8.64, 1);
    expect(r.feeNative).toBeCloseTo(8.64, 2);
    expect(r.feeNativeCurrency).toBe('USD');
  });

  it('phí ngoại tệ (SGD) → quy về USD qua feeRate suy từ processing_fee', () => {
    const r = deriveTxnFee([tx({
      amountSet: { shopMoney: { amount: '238.74', currencyCode: 'USD' } },
      fees: [fee('10.33', 'SGD', '0.0325', 'processing_fee', '0.38'), fee('4.52', 'SGD', '0.015', 'foreign_exchange_fee')],
    })], 'USD');
    expect(r.feeOrderCcy).toBeCloseTo(11.58, 1);
    expect(r.feeNative).toBeCloseTo(14.85, 2);
    expect(r.feeNativeCurrency).toBe('SGD');
  });

  it('bỏ qua transaction FAILURE / AUTHORIZATION không phí', () => {
    const r = deriveTxnFee([
      tx({ kind: 'AUTHORIZATION', status: 'SUCCESS', fees: [] }),
      tx({ kind: 'SALE', status: 'FAILURE', fees: [fee('99', 'USD', '0.0225', 'processing_fee', '0.3')] }),
      tx({ kind: 'CAPTURE', status: 'SUCCESS',
           amountSet: { shopMoney: { amount: '237.80', currencyCode: 'USD' } },
           fees: [fee('5.65', 'USD', '0.0225', 'processing_fee', '0.3')] }),
    ], 'USD');
    expect(r.feeNative).toBeCloseTo(5.65, 2);
  });

  it('đơn không có phí → null hết', () => {
    const r = deriveTxnFee([tx({ fees: [] })], 'USD');
    expect(r.feeOrderCcy).toBeNull();
    expect(r.feeNative).toBeNull();
    expect(r.feeNativeCurrency).toBeNull();
  });

  it('mảng rỗng → null', () => {
    const r = deriveTxnFee([], 'USD');
    expect(r.feeOrderCcy).toBeNull();
  });

  it('phí ngoại tệ không suy được rate → feeOrderCcy null (không hụt số), vẫn có native', () => {
    const r = deriveTxnFee([tx({
      amountSet: { shopMoney: { amount: '100', currencyCode: 'USD' } },
      fees: [fee('4.52', 'SGD', '0', 'foreign_exchange_fee')],
    })], 'USD');
    expect(r.feeOrderCcy).toBeNull();
    expect(r.feeNative).toBeCloseTo(4.52, 2);
    expect(r.feeNativeCurrency).toBe('SGD');
  });

  it('settlement ≤ 0 (flat ≥ proc amount) → feeOrderCcy null', () => {
    const r = deriveTxnFee([tx({
      fees: [fee('0.30', 'SGD', '0.0225', 'processing_fee', '0.30')],
    })], 'USD');
    expect(r.feeOrderCcy).toBeNull();
    expect(r.feeNative).toBeCloseTo(0.30, 2);
  });
});
