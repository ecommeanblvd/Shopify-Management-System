/**
 * Suy phí transaction (theo đồng ĐƠN) từ mảng transactions Shopify. THUẦN.
 * Phí Shopify trả theo payout currency (có thể ≠ đồng đơn) → dùng tỉ lệ
 * feeRate = Σfees / settlement (cùng đồng phí, không thứ nguyên) rồi nhân với
 * sale (đồng đơn) để quy về đồng đơn — sidestep việc đổi chéo tiền tệ.
 */
export interface ShopifyFee {
  amount: { amount: string; currencyCode: string };
  rate: string | null;
  type: string;
  flatFee?: { amount: string } | null;
}
export interface ShopifyTxn {
  kind: string;
  status: string;
  amountSet: { shopMoney: { amount: string; currencyCode: string } };
  fees: ShopifyFee[];
}

export interface DerivedTxnFee {
  feeOrderCcy: number | null;
  feeNative: number | null;
  feeNativeCurrency: string | null;
}

const n = (s: string | null | undefined) => (s == null ? 0 : Number(s));
const r2 = (x: number) => Math.round(x * 100) / 100;

export function deriveTxnFee(transactions: ShopifyTxn[], orderCurrency: string): DerivedTxnFee {
  const relevant = (transactions ?? []).filter(
    (t) => t.status === 'SUCCESS' && (t.kind === 'SALE' || t.kind === 'CAPTURE'),
  );
  let feeOrderCcy = 0;
  let feeNative = 0;
  let nativeCcy: string | null = null;
  let any = false;
  let convertedAll = true; // mọi tx CÓ phí đều quy được về đồng đơn

  for (const t of relevant) {
    const fees = t.fees ?? [];
    if (fees.length === 0) continue;
    any = true;
    const ccy = fees[0].amount.currencyCode; // giả định mọi fee trong 1 tx cùng đồng (payout)
    nativeCcy = nativeCcy ?? ccy;
    const totalFee = fees.reduce((s, f) => s + n(f.amount.amount), 0);
    feeNative += totalFee;

    const sale = n(t.amountSet?.shopMoney?.amount);
    // flatFee CHỈ trừ ở dòng processing_fee (các fee khác không có flat đáng kể).
    const proc = fees.find((f) => f.type === 'processing_fee' && n(f.rate) > 0);
    let converted = false;
    if (proc) {
      const settlement = (n(proc.amount.amount) - n(proc.flatFee?.amount)) / n(proc.rate);
      if (settlement > 0) { feeOrderCcy += sale * (totalFee / settlement); converted = true; }
    } else if (ccy === orderCurrency) {
      feeOrderCcy += totalFee; converted = true;
    }
    if (!converted) convertedAll = false; // không quy được tx này → tổng đồng-đơn không tin được
  }

  if (!any) return { feeOrderCcy: null, feeNative: null, feeNativeCurrency: null };
  return {
    feeOrderCcy: convertedAll ? r2(feeOrderCcy) : null, // hụt 1 phần → null (tránh báo thiếu thành báo thấp)
    feeNative: r2(feeNative),
    feeNativeCurrency: nativeCcy,
  };
}
