/**
 * Tỉ giá Vietcombank (VCB) — client + parser thuần. Dùng để quy đổi giá cước
 * USD (Aramex) sang VND theo tỉ giá VCB hiện hành. Parser THUẦN (test được);
 * chỉ `fetchVcbUsd` chạm mạng.
 */

const DEFAULT_URL = 'https://portal.vietcombank.com.vn/UserControls/TVPortal.TyGia/pXML.aspx';

export interface VcbUsdRate {
  buy: number;      // mua (tiền mặt/chuyển khoản)
  transfer: number; // mua chuyển khoản
  sell: number;     // bán — dùng khi MUA USD trả nhà cung cấp
}

const num = (v: string | undefined): number =>
  v ? Number(v.replace(/[,\s]/g, '')) : NaN;

/** Bóc dòng Exrate USD từ XML VCB. THUẦN, không nổ với input thiếu. */
export function parseVcbUsd(xml: string): VcbUsdRate | null {
  if (!xml) return null;
  // Lấy phần tử <Exrate ... CurrencyCode="USD" ... /> (thứ tự attribute bất kỳ).
  const m = xml.match(/<Exrate\b[^>]*CurrencyCode="USD"[^>]*\/?>/i);
  if (!m) return null;
  const tag = m[0];
  const attr = (name: string) => {
    const a = tag.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    return a ? a[1] : undefined;
  };
  const buy = num(attr('Buy')), transfer = num(attr('Transfer')), sell = num(attr('Sell'));
  if (!Number.isFinite(sell) || sell <= 0) return null;
  return {
    buy: Number.isFinite(buy) ? buy : sell,
    transfer: Number.isFinite(transfer) ? transfer : sell,
    sell,
  };
}

/** Gọi VCB portal lấy tỉ giá USD. Chạm mạng. */
export async function fetchVcbUsd(): Promise<VcbUsdRate> {
  const url = process.env.VCB_FX_URL || DEFAULT_URL;
  const res = await fetch(url, { headers: { Accept: 'application/xml, text/xml, */*' } });
  if (!res.ok) throw new Error(`vcb_http_${res.status}`);
  const rate = parseVcbUsd(await res.text());
  if (!rate) throw new Error('vcb_parse_failed: không thấy tỉ giá USD');
  return rate;
}
