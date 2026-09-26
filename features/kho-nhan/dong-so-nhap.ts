/**
 * THUẦN: luật hiển thị của Sổ nhập kho (bản thiết kế CEO 26/09).
 */

/**
 * Tách "Tên sản phẩm - Màu / Size" thành hai phần để cột Sản phẩm hiện tên
 * đậm, biến thể mờ — đúng như bản thiết kế.
 *
 * Cắt ở dấu `-` CUỐI CÙNG có khoảng trắng hai bên: tên sản phẩm rất hay chứa
 * gạch nối ("Dual Style Bandeau - Nude / L", "Naila Applique - Black / S"), cắt
 * ở dấu đầu tiên là xé mất một nửa cái tên.
 */
export function tachTenBienThe(s: string | null): { ten: string; bienThe: string | null } {
  const t = (s ?? '').trim();
  if (!t) return { ten: '', bienThe: null };
  const i = t.lastIndexOf(' - ');
  if (i < 0) return { ten: t, bienThe: null };
  const ten = t.slice(0, i).trim();
  const bt = t.slice(i + 3).trim();
  // Phần đuôi rỗng hoặc dài bất thường thì không phải biến thể — giữ nguyên cả câu.
  return ten && bt && bt.length <= 40 ? { ten, bienThe: bt } : { ten: t, bienThe: null };
}

export type MauQc = 'dat' | 'hong' | 'cho' | 'du' | 'khac';

/** `QC Check` của Lark → nhóm màu. Tên lựa chọn giữ NGUYÊN VĂN để đối chiếu. */
export function nhomQc(qc: string | null): MauQc {
  const v = (qc ?? '').trim();
  if (v === 'QC Pass') return 'dat';
  if (v === 'QC Failed') return 'hong';
  if (v === 'Tiếp nhận - chưa QC') return 'cho';
  if (v === 'Gửi dư') return 'du';
  return 'khac';
}

export type MauKho = 'luu' | 'tam' | 'cho' | 'tra' | 'khac';

/**
 * `WH - Action` → nhóm màu. So theo TỪ KHOÁ chứ không so bằng, vì cột này có
 * hơn bốn lựa chọn ("Gửi trả Vendor (QC fail)", "Hoàn trả brand (return)"…) và
 * đội kho còn thêm lựa chọn mới.
 */
export function nhomKho(wh: string | null): MauKho {
  const v = (wh ?? '').trim().toLowerCase();
  if (!v) return 'khac';
  if (v.includes('chờ qc')) return 'cho';
  if (v.includes('tạm nhập')) return 'tam';
  if (v.includes('gửi trả') || v.includes('hoàn trả')) return 'tra';
  if (v.includes('lưu kho') || v.includes('nhập lại')) return 'luu';
  return 'khac';
}

export interface CoDon { orderNumber: string | null }

/**
 * Đánh dấu dòng NỐI TIẾP cùng một đơn, để ô mã đơn chỉ hiện ở dòng đầu và
 * đường kẻ giữa các dòng cùng đơn bị ẩn đi (bản thiết kế 26/09).
 *
 * Chỉ tính dòng LIỀN KỀ: danh sách sắp xếp lại theo cột khác thì hai dòng cùng
 * đơn không còn đứng cạnh nhau, gộp theo đơn lúc đó là nói dối người đọc.
 */
export function danhDauNoiTiep<T extends CoDon>(ds: readonly T[]): (T & { noiTiep: boolean })[] {
  return ds.map((r, i) => ({
    ...r,
    noiTiep: i > 0 && !!r.orderNumber && ds[i - 1]!.orderNumber === r.orderNumber,
  }));
}

/**
 * Tên brand để hiện ở cột Brand.
 *
 * `Vendor final` bên Lark chỉ điền 5.227/9.122 dòng (57%) nên cột này trống
 * quá nửa. Tiền tố SKU phủ 8.792/9.122 (96%) và ứng 1:1 với brand — đo 26/09:
 * Denio→DeNio, MR→Mirer, HappyClothing→Happy Clothing, MEAN→MEAN BLVD…
 *
 * Nên lấy `Vendor final` trước; thiếu thì SUY RA từ tiền tố SKU và đánh dấu
 * `suyRa` để giao diện hiện mờ hơn. Cách viết có thể lệch với Lark (Denio vs
 * DeNio) — mờ đi là lời nhắc "đây là mình đoán, không phải Lark ghi".
 */
export function tenBrand(
  vendorFinal: string | null, sku: string | null,
): { ten: string; suyRa: boolean } | null {
  const v = (vendorFinal ?? '').trim();
  if (v) return { ten: v, suyRa: false };
  const tien = (sku ?? '').trim().split('-')[0]?.trim();
  // Tiền tố một ký tự hoặc toàn số không phải tên brand — thà để trống.
  return tien && tien.length >= 2 && !/^\d+$/.test(tien) ? { ten: tien, suyRa: true } : null;
}
