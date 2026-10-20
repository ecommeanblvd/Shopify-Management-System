/**
 * Nhãn một dòng cho tổng hoá đơn điều chỉnh của MỘT tháng.
 *
 * Tách khỏi component vì nhãn này giờ phải vừa một CHIP trên dải "cần chú ý" của màn Đối
 * soát (trước là một thẻ hai dòng). Chỗ chật là chỗ dễ bị rút bớt số, mà mỗi số ở đây là
 * tiền thật: `tong` là tiền carrier trả lại (vào KPI Pillar 3), `tongDebit` là tiền carrier
 * thu thêm — nên nhãn có test riêng, và test đó mới là thứ chặn việc rút bớt.
 *
 * `.ts` thuần, không `.tsx`: vitest của repo chỉ bắt `*.test.ts`.
 */
export interface TongThangCreditNote {
  thang: string;
  tong: number;
  n: number;
  tongDebit: number;
  nDebit: number;
}

const tien = (v: number) => `${Math.round(v).toLocaleString('vi-VN')}đ`;

/**
 * "2026-10: thu hồi 5.400.000đ (3) · trả thêm 1.200.000đ (1)".
 *
 * Phần "trả thêm" chỉ hiện khi có — tháng không có billing note thì thêm một "0đ (0)" vào
 * chip chỉ làm loãng, và số 0 đó không phải việc phải làm.
 */
export function nhanThangCreditNote(t: TongThangCreditNote): string {
  const chinh = `${t.thang}: thu hồi ${tien(t.tong)} (${t.n})`;
  return t.tongDebit ? `${chinh} · trả thêm ${tien(t.tongDebit)} (${t.nDebit})` : chinh;
}
