/**
 * THUẦN: cách TRÌNH BÀY một ô nhật ký lên màn hình (spec §6).
 *
 * Tách khỏi `.tsx` vì `vitest` của repo chạy môi trường `node` và KHÔNG bắt `.tsx`
 * (xem `vitest.config.ts`) — mà hai luật ở đây là luật dễ sai mà mắt không thấy:
 * phân biệt người / máy / chưa-gắn-danh-tính, và nhãn+màu của giá trị dạng chọn.
 */
import { CHUA_GAN_DANH_TINH, type KhoiNhatKy } from '@/features/nhat-ky/gom-dong';

/**
 * Dấu hiện khi ô vốn là NULL — spec §6 chốt đúng ký tự này (en dash).
 *
 * KHÁC HẲN ô bị che: ô bị che hiện `•••` kèm chữ nói rõ vì sao. Dùng chung một dấu cho
 * cả hai là "ẩn im lặng", đúng cái spec §7 cấm — người đọc sẽ tưởng dữ liệu không có.
 */
export const NULL_HIEN = '–';

/** Chữ hiện ở ô bị che. Ngắn, và luôn đi kèm `LY_DO_CHE`. */
export const CHE_HIEN = '•••';

/** Vì sao ô rỗng — phải hiện thành CHỮ, không chỉ là ba dấu chấm. */
export const LY_DO_CHE = 'bị che vì quyền';

/** Người thật, một nguồn máy (cron / webhook / nhập tệp), hay chưa ai gắn danh tính. */
export type KieuTacNhan = 'nguoi' | 'may' | 'chua-gan';

/**
 * Phân loại tác nhân của một khối.
 *
 * `gomKhoi` đã nhập tên người và nhãn máy vào CÙNG một ô `tacNhanNhan`, nên chỉ còn
 * `tacNhanId` phân biệt được hai thứ: người thì luôn có id (xem `idTacNhan`), máy thì
 * không bao giờ có. Và dòng không có cả hai là dòng CHƯA GẮN DANH TÍNH — phải hiện
 * khác máy, vì "Cron" là một câu trả lời còn "không biết ai" là một món nợ.
 */
export function kieuTacNhan(khoi: Pick<KhoiNhatKy, 'tacNhanId' | 'tacNhanNhan'>): KieuTacNhan {
  if (khoi.tacNhanId) return 'nguoi';
  return khoi.tacNhanNhan === CHUA_GAN_DANH_TINH ? 'chua-gan' : 'may';
}

/** Nhãn + màu của một giá trị dạng chọn. */
export interface Chip { nhan: string; mau: string }

/* ---------------------------------------------------------------------------
 * Nhãn + màu cho giá trị dạng CHỌN (enum Postgres, boolean).
 *
 * Tra theo TÊN CỘT, không theo bảng+cột: một danh sách khối của tab "Lịch sử" trộn dòng
 * của bản ghi cha với dòng của dòng con (`nhatKyCuaBanGhi` cuốn cả hai), nên `KhoiNhatKy`
 * cố ý không mang tên bảng — xem `gom-dong.ts`. Tên cột như `qc_result` / `stock_status`
 * chỉ có một nghĩa trong cả CSDL này nên tra theo cột là đủ.
 *
 * Luật màu lấy nguyên của `features/kho-nhan/mau-nhan.ts` để hai màn không nói hai thứ
 * tiếng: màu là KÊNH THỨ HAI (chữ luôn hiện đủ), giá trị áp đảo thì LẶNG, và `red` là
 * màu đã mang nghĩa "QC hỏng" nên chỉ nghĩa đó được dùng.
 *
 * MỌI class phải là CHUỖI LITERAL, không ghép bằng `${}`: Tailwind 4 quét SOURCE để sinh
 * CSS, class ghép lúc chạy không có CSS và chip mất màu sạch sẽ — test đơn vị vẫn xanh.
 * ------------------------------------------------------------------------- */

/** Giá trị lạ / chưa khai dùng cái này — KHÔNG mượn màu đã mang nghĩa. */
const TRUNG_TINH = 'bg-muted text-muted-foreground';

const CHIP: Record<string, Record<string, Chip>> = {
  qc_result: {
    pass: { nhan: 'Đạt', mau: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' },
    fail: { nhan: 'Không đạt', mau: 'bg-red-500/15 text-red-700 dark:text-red-300' },
    pending: { nhan: 'Chờ kiểm', mau: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  },
  disposition: {
    pending: { nhan: 'Chờ xử lý', mau: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
    allocate_to_order: { nhan: 'Giữ cho đơn', mau: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
    store: { nhan: 'Lưu kho', mau: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
    return_to_brand: { nhan: 'Trả brand', mau: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  },
  stock_status: {
    pending: { nhan: 'Chờ', mau: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
    in_stock: { nhan: 'Trong kho', mau: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
    staging: { nhan: 'Khu chờ', mau: 'bg-muted text-muted-foreground' },
    allocated: { nhan: 'Giữ cho đơn', mau: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300' },
    picked: { nhan: 'Đã nhặt', mau: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300' },
    // Đã gửi là trạng thái cuối và chiếm phần lớn hàng cũ → để lặng.
    shipped: { nhan: 'Đã gửi', mau: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' },
    qc_failed: { nhan: 'QC hỏng', mau: 'bg-red-500/15 text-red-700 dark:text-red-300' },
    returned_to_vendor: { nhan: 'Đã trả brand', mau: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  },
  // Cờ vàng "Nhận ngoài kế hoạch" — cùng màu với badge đang hiện ở màn chi tiết lô.
  unplanned: {
    true: { nhan: 'Ngoài kế hoạch', mau: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
    false: { nhan: 'Theo kế hoạch', mau: 'bg-muted text-muted-foreground' },
  },
  source_type: {
    // Retail là loại áp đảo (76% số dòng sổ nhập, đo 28/09/2026) nên phải lặng nhất.
    retail_for_order: { nhan: 'Retail theo đơn', mau: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' },
    consignment: { nhan: 'Consignment', mau: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' },
    po: { nhan: 'PO', mau: 'bg-orange-500/15 text-orange-800 dark:text-orange-300' },
  },
};

/**
 * Chip của một giá trị, hoặc `null` khi cột đó không phải cột dạng chọn.
 *
 * `null` nghĩa là "hiện nguyên văn", KHÔNG phải lỗi: phần lớn cột là chữ/số tự do. Giá trị
 * lạ của một cột ĐÃ khai (enum vừa thêm một nhánh) vẫn ra chip, nhưng chip trung tính và
 * nhãn là nguyên văn giá trị — thấy được chữ thật thì còn tra ra được, còn im lặng bỏ
 * trống thì dòng nhật ký thành vô nghĩa.
 *
 * Tra bằng khoá CỦA CHÍNH đối tượng: tên cột và giá trị tới từ CSDL nên có thể là
 * `constructor` hay `toString`, mà tra kiểu kế thừa prototype sẽ trả về một HÀM.
 */
export function chipGiaTri(cot: string, giaTri: string): Chip | null {
  if (!Object.hasOwn(CHIP, cot)) return null;
  const cuaCot = CHIP[cot];
  if (Object.hasOwn(cuaCot, giaTri)) return cuaCot[giaTri];
  return { nhan: giaTri, mau: TRUNG_TINH };
}

/**
 * Trần ký tự của một ô giá trị trên màn hình.
 *
 * Nhật ký ghi `truoc`/`sau` dạng TEXT cho MỌI kiểu cột, kể cả `jsonb` (xem migration
 * 0210) — `ship_ho_orders.quote_breakdown` là vài KB một ô. Hiện nguyên thì một dòng
 * đẩy cả bảng dài bằng mấy trang và cột "Trường" trôi khỏi màn. Cắt rồi gắn nguyên văn
 * vào `title` nên không mất gì: trỏ chuột vào là thấy đủ.
 */
export const TRAN_KY_TU = 200;

/** `daCat` để màn hình gắn `title` nguyên văn và thêm dấu `…`. */
export function catGiaTri(v: string): { hien: string; daCat: boolean } {
  if (v.length <= TRAN_KY_TU) return { hien: v, daCat: false };
  return { hien: v.slice(0, TRAN_KY_TU), daCat: true };
}
