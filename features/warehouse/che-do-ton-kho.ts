/**
 * Chế độ đồng bộ tồn kho Lark → SMS (biến `WH_TON_KHO_LARK`).
 *
 * AN TOÀN LÀ MẶC ĐỊNH, cùng nguyên tắc `docCheDoGhi` (day-lark.ts): chỉ đúng chuỗi dài, lạ
 * `ghi-that` mới ghi thật vào `warehouse_inventory`; biến trống, chưa đặt hay gõ sai đều là
 * CHẠY THỬ (tính kế hoạch, ghi vào nhật ký tác vụ, không đụng tồn). Tồn kho là số có người
 * và đơn hàng đang dựa vào — một lỗi gõ biến không được biến thành điều chỉnh hàng loạt.
 *
 * Ba giá trị:
 *  - (trống / lạ)          → `dry`. Mặc định.
 *  - `ghi-that`            → `ghi` không hạn mức. Dùng cho trạng thái ổn định, khi lệch hàng
 *                            ngày nhỏ và chốt chặn 25% là đủ canh.
 *  - `ghi-mot-luot:<n>`    → `ghi` MỘT LƯỢT, và chỉ khi kế hoạch có ĐÚNG `n` dòng về 0.
 */
export const GHI_THAT_TON_KHO = 'ghi-that';

/** Tiền tố cờ một lượt. */
const TIEN_TO_MOT_LUOT = 'ghi-mot-luot:';

/**
 * Số dòng-về-0 mà người vận hành KHAI là đã đọc trong kế hoạch; `null` nếu không dùng cờ
 * một lượt.
 *
 * Vì sao cờ phải mang theo một SỐ chứ không phải bật/tắt — và vì sao con số đó là của
 * nhóm "về 0" chứ không phải tổng số dòng:
 *
 *  1. **Tự hết hạn.** Sau lượt sync thành công, số dòng về 0 còn gần 0, nên cùng giá trị cờ
 *     đó KHÔNG còn khớp ⇒ cờ tự vô hiệu. Một cờ bật/tắt để quên ở trạng thái bật sẽ cho
 *     mọi lượt cron sau đó ghi tự do — mà đây là ghi hàng loạt vào tồn kho.
 *  2. **Buộc đã đọc kế hoạch thật.** Muốn gõ đúng `n` thì phải chạy đối soát và đọc nó
 *     (`scripts/du-lieu/doi-soat-ton-kho.ts`). Chốt chặn cũ bảo "xem kế hoạch rồi quyết"
 *     nhưng không có cách nào biết người ta đã xem; con số này là bằng chứng.
 *  3. **Chặn đúng cái chốt chặn sinh ra để chặn.** Nếu view Lark bị sửa bộ lọc hoặc API trả
 *     thiếu giữa chừng thì số dòng về 0 sẽ KHÁC con số đã khai ⇒ từ chối, dù cờ đang bật.
 *
 * FAIL-CLOSED: dạng đúng mà số không hợp lệ (thiếu số, chữ, âm, thập phân) thì trả `null`
 * VÀ `docCheDoTonKho` trả `dry`. Một lỗi gõ không được rơi thành lượt ghi không hạn mức.
 */
export function soVeKhongChoPhep(env: string | undefined): number | null {
  const v = (env ?? '').trim().toLowerCase();
  if (!v.startsWith(TIEN_TO_MOT_LUOT)) return null;
  const phan = v.slice(TIEN_TO_MOT_LUOT.length);
  if (!/^\d+$/.test(phan)) return null;
  const n = Number(phan);
  return Number.isSafeInteger(n) ? n : null;
}

export function docCheDoTonKho(env: string | undefined): 'dry' | 'ghi' {
  const v = (env ?? '').trim().toLowerCase();
  if (v === GHI_THAT_TON_KHO) return 'ghi';
  // Cờ một lượt chỉ là `ghi` khi số khai HỢP LỆ — xem FAIL-CLOSED ở trên.
  return soVeKhongChoPhep(v) === null ? 'dry' : 'ghi';
}
