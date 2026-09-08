/**
 * Tiện ích tháng (THUẦN) dùng chung cho trang lãi gộp và CSV export
 * (`app/(dashboard)/f/orders/lai-gop/page.tsx` và `bang-thang.csv/route.ts`)
 * — trước đây định nghĩa lặp lại y hệt ở cả hai nơi.
 */

/** 'YYYY-MM' hợp lệ hay không. */
export function thangHopLe(s: string | undefined | null): s is string {
  return !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Tháng cách `period` `soThang` tháng về trước, dạng 'YYYY-MM'. */
export function thangTruoc(period: string, soThang: number): string {
  const [nam, thang] = period.split('-').map(Number);
  const tongThang = nam * 12 + (thang - 1) - soThang;
  const namMoi = Math.floor(tongThang / 12);
  const thangMoi = (tongThang % 12) + 1;
  return `${namMoi}-${String(thangMoi).padStart(2, '0')}`;
}

/** Danh sách các tháng từ `tu` đến `den` (bao gồm 2 đầu), tăng dần. Đảo lại
 *  nếu `tu` > `den`. Giới hạn 36 tháng để tránh truy vấn quá lớn. */
export function danhSachThang(tuVao: string, denVao: string): string[] {
  const tu = tuVao <= denVao ? tuVao : denVao;
  const den = tuVao <= denVao ? denVao : tuVao;
  const out: string[] = [];
  let [nam, thang] = tu.split('-').map(Number);
  const [namCuoi, thangCuoi] = den.split('-').map(Number);
  while ((nam < namCuoi || (nam === namCuoi && thang <= thangCuoi)) && out.length < 36) {
    out.push(`${nam}-${String(thang).padStart(2, '0')}`);
    thang += 1;
    if (thang > 12) { thang = 1; nam += 1; }
  }
  return out;
}
