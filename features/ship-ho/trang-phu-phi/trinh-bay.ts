/**
 * THUẦN: cách TRÌNH BÀY một dòng phụ phí cho brand. Không I/O.
 *
 * Tách khỏi `queries.ts` vì ở đây có cái chốt chặn chữ nội bộ (`tenTuNote`) — thứ cần test
 * riêng, không cần cả một database để chạy.
 */

/**
 * `carrier_surcharges.value` nằm ở ĐƠN VỊ CHI PHÍ của tài khoản hãng, không phải luôn là VND:
 * Aramex HN có `cost_currency = 'USD'` (giá gốc rate sheet USD), còn DHL/FedEx/UPS/SF là VND.
 * Viết cứng "đ" là hiện 35đ cho một khoản 35 USD — sai gần 26.000 lần, và đúng kiểu sai mà
 * brand không thể tự phát hiện vì con số trông vẫn hợp lý.
 */
export function tien(n: number, dv: string): string {
  return dv === 'VND'
    ? `${Math.round(n).toLocaleString('vi-VN')}đ`
    : `${n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${dv}`;
}
export const phanTram = (n: number) => `${n.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * `YYYY-MM-DD` từ một cột `timestamp` (không timezone) mà drizzle đã dựng thành `Date`.
 *
 * `String(date).slice(0, 10)` cho ra "Mon Sep 2" — không phải ngày ISO. Bản đầu dùng nó nên MỌI
 * tuần dầu bị lọc sạch (lọt 0 tuần trên dữ liệu thật của kalisa) mà trang vẫn dựng được.
 * `toISOString()` thì lệch một ngày vì nó quy sang UTC, còn cột này là giờ-treo-tường — nên
 * đọc đúng bằng các phần ngày theo giờ địa phương, chính là thứ drizzle vừa dựng ra.
 */
export function ngay(d: unknown): string | null {
  if (d == null) return null;
  if (d instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  return String(d).slice(0, 10);
}

/** Mức hiện ra sao, theo `kind`. Phần trăm và tiền đọc khác nhau nên không gộp một hàm. */
export function dinhDangGiaTri(kind: string, value: number, valuePerKg: number | null, stepKg: number | null, dv: string): string {
  if (kind.endsWith('_percent')) return phanTram(value);
  if (kind === 'demand_per_kg' || kind === 'per_kg_fixed') return `${tien(value, dv)}/kg`;
  if (kind === 'per_step_fixed') return `${tien(value, dv)} mỗi ${stepKg ?? 1}kg`;
  // `remote_fixed` của FedEx có cả hai vế và lấy mức CAO HƠN — phải nói ra, không chỉ hiện một số.
  if (valuePerKg != null && valuePerKg > 0) {
    return `${tien(value, dv)}/đơn hoặc ${tien(valuePerKg, dv)}/kg — lấy mức cao hơn`;
  }
  return `${tien(value, dv)}/đơn`;
}

/* Dấu hiệu chữ NỘI BỘ. Đây là cái chốt THỨ HAI, không phải cái duy nhất: cái thứ nhất là
 * phép cắt theo cấu trúc ở `tenTuNote`, vốn đã bỏ hết phần sau dấu gạch dài. Hai lớp vì lớp
 * nào cũng có thể hụt, mà hụt ở trang gửi brand là lộ chuyện nội bộ. */
const DAU_NOI_BO = /#|\d\s*%|\bCEO\b|backfill|hoá đơn|hoa don|billed|invoice|PDF|spec|migration|MBLVD|duyệt|khảo/i;

/**
 * Tên dòng theo cách HÃNG gọi, cắt ra từ `note`, hoặc `null` khi không cắt được an toàn.
 *
 * Vì sao phải có: bỏ hẳn `note` thì sáu dòng addon của Aramex chỉ còn "Dịch vụ cộng thêm =
 * 15,00 USD/đơn" sáu lần — brand không đối soát được dòng nào là dòng nào.
 * Vì sao không lấy nguyên văn: `note` là sổ tay nội bộ, có mã kiện của brand khác, tỉ lệ mình
 * tự khảo hoá đơn, ngày CEO duyệt.
 *
 * Phép cắt: lấy đoạn TRƯỚC dấu `—` / `|` / `·` đầu tiên — mọi dòng trong dữ liệu thật đều viết
 * tên trước, lý lịch sau. Rồi chặn nếu đoạn đó dài quá 60 ký tự hoặc trúng `DAU_NOI_BO`.
 * Đo trên 42 dòng đang mở (02/10/2026): 36 ra tên sạch, 4 bị chặn (vd "VAT 8%", mô tả DHL
 * remote dài), 2 trống. Mọi ca chặn đều RƠI VỀ nhãn chung — hụt thì mất chữ, không lộ chữ.
 */
export function tenTuNote(note: string | null): string | null {
  const cat = (note ?? '').split(/—|\||·/)[0].trim();
  if (!cat || cat.length > 60 || DAU_NOI_BO.test(cat)) return null;
  return cat;
}

/**
 * Câu "cách tính" đã khớp với mức THẬT của dòng.
 *
 * `loaiChoPhep` trả câu chung cho cả `kind`, nhưng `remote_fixed` có hai dạng: FedEx Tier B/C và
 * UPS Remote thu max(tiền/đơn, tiền/kg), còn Tier A và UPS Extended chỉ thu tiền/đơn. Để câu
 * chung thì trang hiện "646.720đ/đơn" ngay cạnh "hoặc theo kg — lấy mức cao hơn" — một trang
 * đối soát tự mâu thuẫn trong cùng một hàng thì brand phải đi hỏi, đúng thứ nó sinh ra để khỏi.
 */
export function cachTinhThat(cachTinh: string, valuePerKg: number | null): string {
  return valuePerKg != null && valuePerKg > 0
    ? cachTinh
    : cachTinh.replace(', hoặc theo kg — lấy mức cao hơn', '');
}

/**
 * Mức VAT dùng CHUNG cho mọi hãng trên trang ("8,00%"), hoặc `null` khi các hãng khác nhau.
 *
 * Câu "VAT tính sau cùng" đặt ở đầu trang, trên mọi hãng, nên không được viết cứng "8%": ghi chú
 * trong dữ liệu nói rõ 8% là mức GIẢM TẠM từ 10%. Viết cứng là đến ngày nó về 10% thì bảng dưới
 * đổi theo dữ liệu còn câu ở trên vẫn nói 8% — brand đối soát theo câu sai mà không ai biết.
 * Hãng nào đó khác mức thì trả `null` và trang nói "VAT theo bảng dưới" thay vì chọn bừa một số.
 */
export function mucVatChung(hang: readonly { dong: readonly { dong: string; giaTri: string }[] }[]): string | null {
  const ds = new Set(hang.flatMap((h) => h.dong.filter((d) => d.dong === 'vat').map((d) => d.giaTri)));
  return ds.size === 1 ? [...ds][0] : null;
}

/** `jsonb` nước → mảng ISO-2 đã sắp, hoặc `null`. Dữ liệu jsonb nên không tin kiểu sẵn. */
export function maNuoc(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const ds = v.filter((x): x is string => typeof x === 'string' && x.length === 2).map((x) => x.toUpperCase());
  return ds.length ? [...new Set(ds)].sort() : null;
}
