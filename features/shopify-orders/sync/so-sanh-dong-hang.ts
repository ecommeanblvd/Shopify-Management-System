/**
 * So payload Shopify với dòng hàng ĐANG CÓ trong CSDL → chèn gì / sửa gì / xoá gì.
 *
 * VÌ SAO có tệp này: `upsert-order.ts` trước đây xoá sạch `shopify_order_lines` của đơn
 * rồi chèn lại toàn bộ MỖI lượt đồng bộ. Một đơn 5 dòng được cron chạm lại mà không đổi gì
 * vẫn sinh 5 lệnh xoá + 5 lệnh chèn. Khi trigger nhật ký được bật cho bảng này (spec §8),
 * mỗi lượt như thế đẻ ra N dòng `xoa` + N dòng `them` NỘI DUNG Y HỆT NHAU — nhiễu tới mức
 * không ai mở nhật ký nữa, và chiếm phần lớn khối lượng của cả bảng nhật ký.
 *
 * VÌ SAO so ở TypeScript chứ không `INSERT ... ON CONFLICT DO UPDATE`: `ON CONFLICT` cần
 * một ràng buộc unique, mà `shopify_order_lines` KHÔNG có cái nào trên
 * `(order_id, shopify_line_id)` (kiểm production 20/10/2026 — chỉ có khoá chính `id` và
 * bốn chỉ mục thường). Thêm unique là một lệnh DDL trên bảng 22.608 dòng đang chạy thật,
 * ngoài phạm vi task. So ở đây còn làm được hai việc `ON CONFLICT` không làm: BỎ HẲN lệnh
 * ghi cho dòng không đổi (chứ không chỉ ghi lại cùng giá trị), và dọn bản dư mà kiểu cũ
 * có thể đã để lại.
 *
 * THUẦN, không I/O: `upsert-order.ts` lo phần SQL. Tách ra vì đây là chỗ duy nhất của
 * tính năng mà `vitest` kiểm được — bộ test tích hợp của `upsert-order` cần
 * `TEST_DATABASE_URL` nên nó đang SKIP, tức một test ở đó sẽ xanh giả.
 */
import type { MappedOrder } from './shopify-mapper';

/** Dòng hàng như `shopify-mapper.ts` sinh ra từ payload Shopify. */
export type DongHangMoi = MappedOrder['lines'][number];

/**
 * Dòng hàng ĐỌC LÊN từ CSDL: cùng các cột, nhưng kiểu là kiểu CSDL trả về —
 * `numeric` ra chuỗi theo dạng chuẩn của Postgres, `jsonb` ra `unknown`.
 */
export interface DongHangDangCo {
  id: string;
  shopifyLineId: string;
  shopifyVariantId: string | null;
  shopifyProductId: string | null;
  sku: string | null;
  vendor: string | null;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  unitPrice: string;
  discountAlloc: string;
  total: string;
  processingMinDays: number | null;
  processingMaxDays: number | null;
  estimatedDelivery: string | null;
  eddMin: string | null;
  eddMax: string | null;
  soDo: unknown;
}

export interface KeHoachDongHang {
  /** Dòng chưa có trong CSDL. */
  chen: DongHangMoi[];
  /** Dòng đã có VÀ có ít nhất một ô khác — `gia` là giá trị mới của cả dòng. */
  sua: Array<{ id: string; gia: DongHangMoi }>;
  /** Khoá chính của dòng phải xoá: không còn trong payload, hoặc là bản dư. */
  xoa: string[];
}

/** `null` và `undefined` gộp làm một; ngoài ra so đúng từng ký tự. */
function bangChu(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * So SỐ, không so chuỗi. `numeric(14,2)` của Postgres trả về dạng chuẩn hoá (`'120.00'`)
 * còn Shopify trả nguyên văn chuỗi của nó (`'120.0'`) — so bằng chuỗi là mỗi lượt đồng bộ
 * sinh một lệnh ghi rỗng cho MỌI dòng hàng, tức đúng cái nhiễu tệp này tồn tại để dẹp.
 */
function bangSo(a: string | number | null, b: string | number | null): boolean {
  if (a === null || b === null) return a === b;
  return Number(a) === Number(b);
}

/**
 * So `jsonb` theo NỘI DUNG, SÂU — không so chuỗi.
 *
 * VÌ SAO không `JSON.stringify` (sửa 20/10/2026, chú thích cũ giải thích SAI nguyên nhân):
 * bản cũ so hai chuỗi và nói là "thứ tự do Shopify giữ nguyên". Thứ giữ nó đúng tới hôm nay
 * KHÔNG phải Shopify mà là `jsonb` của Postgres: `jsonb` **tự sắp lại khoá của object**
 * theo (ĐỘ DÀI khoá, rồi bytewise). `so_do` là mảng `{nhan, giaTri}`, và `'nhan'` (4 ký tự)
 * ngắn hơn `'giaTri'` (6) nên bản đọc lên tình cờ trùng thứ tự object literal của
 * `shopify-mapper.ts`. Một sự trùng khớp, không phải một bảo đảm.
 *
 * Thêm hoặc đổi MỘT khoá CÙNG ĐỘ DÀI là vỡ ngay: `ghiChu` và `giaTri` đều 6 ký tự, bytewise
 * `'ghiChu' < 'giaTri'`, nên `jsonb` trả về `{nhan, ghiChu, giaTri}` trong khi mapper dựng
 * `{nhan, giaTri, ghiChu}`. Hai chuỗi khác nhau ⇒ MỌI dòng hàng của MỌI đơn báo "đã đổi" ở
 * MỌI lượt đồng bộ — tức dựng lại đúng cái lũ nhiễu mà cả tệp này tồn tại để dẹp, và dựng
 * lại một cách IM LẶNG (không lỗi, chỉ là nhật ký lại ngập dòng rỗng).
 *
 * So sâu thì thứ tự khoá không còn là một giả định nào nữa. Thứ tự PHẦN TỬ MẢNG thì vẫn
 * được tôn trọng (so theo chỉ số): `jsonb` giữ nguyên thứ tự mảng, và thứ tự các ô khách
 * nhập là một phần nội dung — đảo hai ô là một thay đổi thật.
 */
function bangJson(a: unknown, b: unknown): boolean {
  return bangSau(a ?? null, b ?? null);
}

/**
 * So hai giá trị JSON theo nghĩa: mảng so theo chỉ số, object so theo TẬP KHOÁ (không theo
 * thứ tự khoá), còn lại so `===`.
 *
 * `undefined` đã được gộp về `null` ở `bangJson` trước khi vào đây; bên trong một giá trị
 * đọc từ `jsonb` thì không có `undefined` (JSON không có kiểu đó).
 */
function bangSau(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  const aMang = Array.isArray(a);
  if (aMang !== Array.isArray(b)) return false;
  if (aMang) {
    const x = a as unknown[];
    const y = b as unknown[];
    return x.length === y.length && x.every((v, i) => bangSau(v, y[i]));
  }

  // `Object.keys` chỉ lấy khoá của CHÍNH đối tượng, và giá trị đọc từ `jsonb` là object
  // thuần — nên không có đường nào để một khoá kế thừa lọt vào phép so.
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => (
    Object.hasOwn(b as Record<string, unknown>, k)
    && bangSau((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
  ));
}

/** Một ô nào khác là cả dòng phải ghi lại — hàm này quyết "khác" cho từng kiểu cột. */
function coDoi(cu: DongHangDangCo, moi: DongHangMoi): boolean {
  return (
    !bangChu(cu.shopifyVariantId, moi.shopifyVariantId) ||
    !bangChu(cu.shopifyProductId, moi.shopifyProductId) ||
    !bangChu(cu.sku, moi.sku) ||
    !bangChu(cu.vendor, moi.vendor) ||
    !bangChu(cu.productTitle, moi.productTitle) ||
    !bangChu(cu.variantTitle, moi.variantTitle) ||
    !bangSo(cu.quantity, moi.quantity) ||
    !bangSo(cu.unitPrice, moi.unitPrice) ||
    !bangSo(cu.discountAlloc, moi.discountAlloc) ||
    !bangSo(cu.total, moi.total) ||
    !bangSo(cu.processingMinDays, moi.processingMinDays) ||
    !bangSo(cu.processingMaxDays, moi.processingMaxDays) ||
    !bangChu(cu.estimatedDelivery, moi.estimatedDelivery) ||
    !bangChu(cu.eddMin, moi.eddMin) ||
    !bangChu(cu.eddMax, moi.eddMax) ||
    !bangJson(cu.soDo, moi.soDo)
  );
}

/**
 * Ghép theo `shopify_line_id` — khoá tự nhiên của một dòng hàng TRONG MỘT ĐƠN.
 *
 * Ghép bằng HÀNG ĐỢI (mảng cho mỗi khoá, lấy ra dần) chứ không phải một ô một khoá: bảng
 * không có ràng buộc unique nên hai dòng cùng `shopify_line_id` là chuyện có thể xảy ra
 * (hai lượt đồng bộ chồng nhau dưới kiểu xoá-rồi-chèn cũ). Hàng đợi khớp một-đổi-một rồi
 * đẩy phần dư sang `xoa`, nên lượt đồng bộ sau tự dọn thay vì giữ bản dư mãi.
 *
 * Shopify ĐÁNH SỐ LẠI `line_item.id` khi đơn bị sửa, nên ca sửa đơn vẫn ra một cặp
 * xoá+chèn. Đó là sự thật đáng ghi (dòng cũ mất, dòng mới có), khác hẳn cái nhiễu của kiểu
 * cũ là xoá+chèn cho dòng KHÔNG đổi gì.
 *
 * ⚠ HỆ QUẢ MÀ MỌI NƠI ĐỌC DÒNG HÀNG PHẢI BIẾT: kiểu xoá-rồi-chèn cũ làm thứ tự VẬT LÝ của
 * hàng trong heap ≈ thứ tự payload, nên một `SELECT` không `ORDER BY` tình cờ ra đúng thứ
 * tự khách thấy lúc đặt. Sửa tại chỗ thì không: `UPDATE` của Postgres ghi một phiên bản
 * MỚI của hàng ở cuối heap, nên dòng vừa sửa nhảy xuống cuối danh sách. Thiếu `ORDER BY`
 * vốn đã là lỗ hổng; thay đổi này biến nó thành có thật. Ba nơi đọc đã được sắp theo
 * `shopify_line_id` + `id` (khoá tự nhiên của một dòng trong một đơn, cộng một chốt vì bảng
 * KHÔNG có unique trên `(order_id, shopify_line_id)`): `order-actions.ts` (chi tiết đơn),
 * `dashboard-actions.ts` (bảng đơn) và `features/customer-account/order-requests.ts` (màn
 * KHÁCH xem). Thêm nơi đọc thứ tư thì phải sắp như vậy.
 */
export function soSanhDongHang(
  dangCo: readonly DongHangDangCo[],
  moi: readonly DongHangMoi[],
): KeHoachDongHang {
  const theoKhoa = new Map<string, DongHangDangCo[]>();
  for (const d of dangCo) {
    const hang = theoKhoa.get(d.shopifyLineId);
    if (hang) hang.push(d);
    else theoKhoa.set(d.shopifyLineId, [d]);
  }

  const ke: KeHoachDongHang = { chen: [], sua: [], xoa: [] };
  for (const m of moi) {
    const cu = theoKhoa.get(m.shopifyLineId)?.shift();
    if (!cu) {
      ke.chen.push(m);
      continue;
    }
    if (coDoi(cu, m)) ke.sua.push({ id: cu.id, gia: m });
  }

  // Thứ tự `xoa` theo thứ tự đọc lên của `dangCo` — để test ghim được, và để log đọc được.
  for (const d of dangCo) {
    if (theoKhoa.get(d.shopifyLineId)?.includes(d)) ke.xoa.push(d.id);
  }
  return ke;
}
