/**
 * So billed (hóa đơn thực FedEx) vs FedEx-quote (giá hợp đồng từ Rate API)
 * theo TỪNG DÒNG. FedEx-quote = "giá đúng"; billed cao hơn = FedEx thu sai
 * → đòi NCC sửa bill. Pure, để unit-test.
 */

export interface FedexQuoteSnap {
  service: string;
  totalNetCharge: number | null; // gồm VAT
  fuel: number | null;
  fuelPercent: number | null;
  remote: number | null;
  demand: number | null;
  residential: number | null;
  signature: number | null; // ký nhận thật (SIGNATURE_OPTION); API quote thường = 0
  countryFixed: number | null; // phí cố định nước (ANCILLARY_FEE = US Inbound Processing Fee)
  vat: number | null;
  discount: number | null;
  rateZone: string | null;
}

/** Cước gốc FedEx suy ra = tổng − mọi phụ phí − VAT (Rate API không trả base riêng cho ACCOUNT). */
export function fedexImpliedBase(q: FedexQuoteSnap): number | null {
  if (q.totalNetCharge === null) return null;
  return q.totalNetCharge - (q.fuel ?? 0) - (q.remote ?? 0) - (q.demand ?? 0)
    - (q.residential ?? 0) - (q.signature ?? 0) - (q.countryFixed ?? 0) - (q.vat ?? 0);
}

export interface BilledSnap {
  total: number;
  fuel: number | null;
  remote: number | null;
  demand: number | null;
  signature: number | null;
  vat: number | null;
}

export interface QuoteLine {
  key: 'fuel' | 'remote' | 'demand' | 'signature' | 'vat' | 'total';
  label: string;
  billed: number;
  quote: number;
  delta: number; // billed − quote (dương = FedEx thu cao hơn giá HĐ)
}

export interface QuoteCompare {
  lines: QuoteLine[];
  totalDelta: number;
  totalDeltaPct: number;
  /** billed cao hơn giá HĐ quá ngưỡng → khả năng FedEx thu sai. */
  overcharged: boolean;
  verdict: string;
}

/** Dưới ngưỡng này coi như khớp giá hợp đồng (sai số làm tròn). */
export const FEDEX_QUOTE_TOLERANCE_PCT = 2;

const n0 = (v: number | null): number => v ?? 0;
const r0 = (v: number): number => Math.round(v);

const LABELS: Record<QuoteLine['key'], string> = {
  fuel: 'Phí nhiên liệu', remote: 'Phí vùng xa', demand: 'Phí nhu cầu',
  signature: 'Ký nhận/bổ sung', vat: 'VAT', total: 'Tổng',
};

export function compareBilledVsFedexQuote(b: BilledSnap, q: FedexQuoteSnap): QuoteCompare {
  const pair: Array<[QuoteLine['key'], number, number]> = [
    ['fuel', n0(b.fuel), n0(q.fuel)],
    ['remote', n0(b.remote), n0(q.remote)],
    ['demand', n0(b.demand), n0(q.demand)],
    ['signature', n0(b.signature), n0(q.signature)],
    ['vat', n0(b.vat), n0(q.vat)],
    ['total', b.total, n0(q.totalNetCharge)],
  ];
  const lines: QuoteLine[] = pair.map(([key, billed, quote]) => ({
    key, label: LABELS[key], billed: r0(billed), quote: r0(quote), delta: r0(billed - quote),
  }));

  const totalLine = lines.find((l) => l.key === 'total')!;
  const totalDelta = totalLine.delta;
  const totalDeltaPct = totalLine.quote > 0 ? (totalDelta / totalLine.quote) * 100 : 0;
  const overcharged = totalDeltaPct > FEDEX_QUOTE_TOLERANCE_PCT;

  // Dòng phụ phí lệch mạnh nhất (bỏ 'total') để nêu nguyên nhân.
  const driver = lines
    .filter((l) => l.key !== 'total')
    .reduce((a, b2) => (Math.abs(b2.delta) > Math.abs(a.delta) ? b2 : a), { key: 'fuel', delta: 0 } as QuoteLine);

  let verdict: string;
  if (Math.abs(totalDeltaPct) <= FEDEX_QUOTE_TOLERANCE_PCT) {
    verdict = `Khớp giá hợp đồng FedEx (lệch ${totalDeltaPct.toFixed(1)}%)`;
  } else if (totalDelta > 0) {
    verdict = `FedEx thu cao hơn giá HĐ ${totalDelta.toLocaleString('vi-VN')}đ` +
      (Math.abs(driver.delta) > 0 ? ` — chủ yếu ở ${driver.label} (${driver.delta > 0 ? '+' : ''}${driver.delta.toLocaleString('vi-VN')}đ) → đòi NCC` : ' → đòi NCC');
  } else {
    verdict = `FedEx thu THẤP hơn giá HĐ ${Math.abs(totalDelta).toLocaleString('vi-VN')}đ (có lợi)`;
  }

  return { lines, totalDelta, totalDeltaPct, overcharged, verdict };
}
