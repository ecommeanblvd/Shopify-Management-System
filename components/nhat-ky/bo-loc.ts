/**
 * THUẦN: đọc bộ lọc của trang `/f/nhat-ky` từ URL, và dựng danh sách chọn cho ô lọc.
 *
 * Tách khỏi `page.tsx` vì `vitest` không bắt `.tsx`, mà hai thứ ở đây sai là sai lặng:
 * ranh giới NGÀY (lệch 7 tiếng thì mất hoặc thêm cả một ngày thay đổi) và việc chặn tên
 * bảng lạ từ URL trước khi nó đi vào câu SQL.
 */
import { CAU_HINH } from '@/features/nhat-ky/cot-theo-doi';
import type { KhoiNhatKy } from '@/features/nhat-ky/gom-dong';
import { MUI_GIO_KINH_DOANH } from '@/lib/timezone';

/**
 * Nhãn tiếng Việt của bảng — chữ dùng ở ô chọn "Bảng" và ở bảng số nợ danh tính.
 *
 * Lấy theo tên MODULE người dùng đang gọi trên màn hình, không dịch máy móc tên bảng:
 * người đọc nhật ký là người đang làm ở màn đó.
 */
export const NHAN_BANG: Record<string, string> = {
  goods_receipt_items: 'Chiếc trong lô nhập kho',
  goods_receipts: 'Lô nhập kho',
  warehouse_inventory: 'Tồn kho',
  inventory_movements: 'Biến động tồn',
  order_fulfillment: 'Đơn cần giao',
  order_fulfillment_lines: 'Dòng hàng của đơn cần giao',
  shipments: 'Kiện hàng',
  ship_ho_orders: 'Đơn ship hộ',
  shopify_orders: 'Đơn Shopify',
  shopify_order_lines: 'Dòng hàng đơn Shopify',
};

/** Nhãn của một bảng, hoặc chính tên bảng khi chưa khai — tên bảng khó đọc nhưng vẫn
 *  trả lời được "bảng nào", còn ô trống thì dòng số nợ thành vô nghĩa. */
export function nhanBang(bang: string): string {
  return Object.hasOwn(NHAN_BANG, bang) ? NHAN_BANG[bang] : bang;
}

/**
 * Bảng đứng ĐẦU ô chọn, và cũng là bảng mặc định của trang.
 *
 * `goods_receipt_items` vì hôm nay đây là bảng DUY NHẤT có trigger đang sống (nhập kho /
 * QC). Mở trang ra mà rơi vào một bảng chưa bật trigger thì CEO thấy bảng rỗng và kết
 * luận tính năng không chạy.
 */
export const BANG_MAC_DINH = 'goods_receipt_items';

/**
 * Các bảng chọn được — lấy từ `CAU_HINH` chứ không gõ lại danh sách thứ hai: khai thêm
 * một bảng ở `cot-theo-doi.ts` là nó có mặt ở đây luôn. Bảng mặc định lên đầu, phần còn
 * lại giữ nguyên thứ tự của `CAU_HINH`.
 *
 * Bảng chưa bật trigger vẫn có trong danh sách (trigger bật/gỡ bằng
 * `scripts/nhat-ky-bat-tat.ts`, mã không đọc được trạng thái đó) — chọn vào thì trang
 * hiện đúng là chưa có dòng nào, không giả vờ là lỗi.
 */
export const CAC_BANG: readonly string[] = [
  BANG_MAC_DINH,
  ...CAU_HINH.map((c) => c.bang).filter((b) => b !== BANG_MAC_DINH),
];

/** Chặn tên bảng lạ từ URL ngay tại biên: chỉ tên có trong `CAU_HINH` đi tiếp. */
export function docBang(v: unknown): string {
  return typeof v === 'string' && CAC_BANG.includes(v) ? v : BANG_MAC_DINH;
}

/** Ô lọc chữ (người, trường): rỗng nghĩa là KHÔNG lọc theo ô đó. */
export function docChu(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/**
 * Mốc đầu/cuối của một ngày lịch `YYYY-MM-DD` **theo giờ Việt Nam**.
 *
 * Phải ghim `+07:00` vào chuỗi, không dùng `new Date('2026-10-20')`: cách đó đọc theo UTC
 * nên "từ ngày 20/10" sẽ hứng thêm 7 tiếng của tối 19/10, còn `new Date('…T00:00:00')` thì
 * đọc theo giờ của MÁY CHỦ — mà máy chủ chạy UTC. Hai cách đều lệch một phần ngày, và cái
 * lệch đó không ai thấy: danh sách vẫn ra kết quả, chỉ là sai mép.
 *
 * `cuoi` lấy 23:59:59.999 vì `nhatKyCuaBang` dùng `<=` (`lte`) — lấy 00:00:00 của ngày sau
 * sẽ hứng thêm đúng một mốc của ngày hôm sau.
 */
export function docNgay(v: unknown, mep: 'dau' | 'cuoi'): Date | undefined {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T${mep === 'dau' ? '00:00:00.000' : '23:59:59.999'}+07:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** 'YYYY-MM-DD' theo giờ nghiệp vụ — giá trị cho `<input type="date">`. */
export function homNayVn(bayGio: Date = new Date()): string {
  return bayGio.toLocaleDateString('en-CA', { timeZone: MUI_GIO_KINH_DOANH });
}

export interface MucChon { gia: string; nhan: string }

/**
 * Danh sách NGƯỜI để chọn, suy từ chính các khối đang đọc được.
 *
 * Cố ý không truy vấn thêm bảng nhật ký để lấy danh sách người: `queries.ts` là chỗ DUY
 * NHẤT đọc `nhat_ky_thay_doi` (và là chỗ duy nhất áp phân quyền), nên màn hình chỉ được
 * chọn trong những gì nó đã đọc. Hệ quả phải biết: người không có thay đổi nào trong
 * khoảng ngày đang xem thì không xuất hiện trong ô chọn — đúng chiều, vì chọn họ cũng ra
 * danh sách rỗng.
 *
 * Chỉ người THẬT vào danh sách: khối của máy và khối chưa gắn danh tính không có
 * `tacNhanId`, mà `nhatKyCuaBang` lọc theo đúng `tac_nhan_id` — không có id thì không lọc
 * được, và bày một mục bấm vào là ra rỗng thì tệ hơn là không bày.
 */
export function nguoiTrongKhoi(khoi: readonly KhoiNhatKy[]): MucChon[] {
  const theoId = new Map<string, string>();
  for (const k of khoi) if (k.tacNhanId) theoId.set(k.tacNhanId, k.tacNhanNhan);
  return [...theoId].map(([gia, nhan]) => ({ gia, nhan }))
    .sort((a, b) => a.nhan.localeCompare(b.nhan, 'vi'));
}

/**
 * Danh sách TRƯỜNG để chọn: giá trị là tên cột thật (`qc_result`), nhãn là tiếng Việt —
 * `nhatKyCuaBang` lọc theo tên cột thật, còn người đọc chỉ biết nhãn.
 *
 * Suy từ các khối đang đọc được, cùng lý do như `nguoiTrongKhoi`. Thêm nữa: với bảng chế
 * độ `tru` (ghi mọi cột trừ danh sách loại trừ) thì `cot-theo-doi.ts` KHÔNG có danh sách
 * cột để duyệt — danh sách cột thật chỉ có trong CSDL.
 */
export function truongTrongKhoi(khoi: readonly KhoiNhatKy[]): MucChon[] {
  const theoTruong = new Map<string, string>();
  for (const k of khoi) for (const d of k.dong) theoTruong.set(d.truong, d.nhan);
  return [...theoTruong].map(([gia, nhan]) => ({ gia, nhan }))
    .sort((a, b) => a.nhan.localeCompare(b.nhan, 'vi'));
}
