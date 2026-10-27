/**
 * Cổng CHỈ-ĐỌC cho tác vụ xử lý báo lỗi hằng đêm: một danh sách truy vấn KHAI SẴN, không SQL
 * tự do, không ghi, không trả dữ liệu cá nhân của khách.
 *
 * ## Vì sao có (27/10/2026, sau BL-2)
 *
 * Lượt chạy hằng đêm 26/10 đã đi ĐÚNG con đường đúng — grep ra `xem-truoc-van-don.ts`, tìm ra
 * `lyDoTrong`, liệt kê đủ 12 đường `return null` của `lay-gia-uoc-tinh.ts` — rồi **buộc phải
 * dừng ở `can_nguoi`** vì mọi bằng chứng quyết định đều nằm trong CSDL production mà nó không
 * có quyền đọc. Gốc thật của BL-2 là **`job_runs` có 0 lượt cho `dien-bu-gia-uoc-tinh`**: một
 * truy vấn đếm. Thiếu nó, với MỌI lỗi phụ thuộc dữ liệu câu trả lời của nó sẽ luôn là "không
 * tái hiện được".
 *
 * Và nó còn tin **chú thích trong mã** (*"cron sẽ thử lại"*) thay vì kiểm sổ tác vụ — đúng câu
 * sai. Muốn kiểm thì cần đúng truy vấn này.
 *
 * ## Ranh giới, và vì sao đặt ở đây
 *
 * Luật 3 của tác vụ đó — KHÔNG chạm CSDL production — vẫn giữ nguyên tinh thần: nó không có
 * chuỗi kết nối, không chạy SQL của riêng nó, chỉ gọi được đúng những câu ở đây. Danh sách này
 * là toàn bộ quyền đọc của nó, nên thêm câu mới là một quyết định có ý thức, không phải tiện tay.
 *
 * KHÔNG trả: tên, email, số điện thoại, địa chỉ, mã bưu chính của khách. Nước đến thì CÓ, vì
 * chính nó là đầu vào của nhánh `!k.country` đang cần chẩn.
 */

/** Tên truy vấn hợp lệ. Thêm tên mới là mở thêm quyền đọc — xem phần ranh giới ở trên. */
export const TRUY_VAN_CHO_PHEP = [
  'job-runs',      // lượt chạy gần nhất của MỘT khoá tác vụ (cần `key`)
  'job-chua-chay', // khoá trong sổ đăng ký mà `job_runs` CHƯA BAO GIỜ có dòng nào
  'kien',          // một kiện theo mã LOG hoặc mã vận đơn (cần `ma`)
  'kien-mac-gia',  // kiện đã nhập mã qua hệ thống mà chưa ghi được giá lên Lark
] as const;
export type TenTruyVan = (typeof TRUY_VAN_CHO_PHEP)[number];

export const GIOI_HAN_DONG = 50;

export interface YeuCauChanDoan {
  ten: TenTruyVan;
  /** Khoá tác vụ, chỉ cho `job-runs`. */
  key: string | null;
  /** Mã LOG (`PK-…`) hoặc mã vận đơn, chỉ cho `kien`. */
  ma: string | null;
  limit: number;
}

export type KetDoc =
  | { ok: true; yc: YeuCauChanDoan }
  | { ok: false; loi: string };

const laTen = (v: string): v is TenTruyVan => (TRUY_VAN_CHO_PHEP as readonly string[]).includes(v);

/**
 * THUẦN: đọc tham số truy vấn thành một yêu cầu đã kiểm, hoặc lý do từ chối.
 *
 * FAIL-CLOSED theo DANH SÁCH TRẮNG: thiếu `q`, hay `q` lạ, đều từ chối và nói ra các tên hợp
 * lệ — không có đường nào rơi về "chạy hết" hay "chạy mặc định". `limit` xấu thì KẸP về
 * `GIOI_HAN_DONG` thay vì từ chối: một con số gõ lệch không nên làm hỏng lượt chẩn, nhưng cũng
 * không được phép kéo cả bảng về.
 */
export function docYeuCauChanDoan(sp: URLSearchParams): KetDoc {
  const q = (sp.get('q') ?? '').trim();
  if (!q) return { ok: false, loi: `thiếu q — tên hợp lệ: ${TRUY_VAN_CHO_PHEP.join(', ')}` };
  if (!laTen(q)) return { ok: false, loi: `q không hợp lệ: ${q} — tên hợp lệ: ${TRUY_VAN_CHO_PHEP.join(', ')}` };

  const key = (sp.get('key') ?? '').trim() || null;
  const ma = (sp.get('ma') ?? '').trim() || null;
  if (q === 'job-runs' && !key) return { ok: false, loi: 'job-runs cần tham số key (khoá tác vụ)' };
  if (q === 'kien' && !ma) return { ok: false, loi: 'kien cần tham số ma (mã LOG PK-… hoặc mã vận đơn)' };

  const thoLimit = Number(sp.get('limit'));
  const limit = Number.isInteger(thoLimit) && thoLimit > 0 && thoLimit <= GIOI_HAN_DONG
    ? thoLimit : GIOI_HAN_DONG;

  return { ok: true, yc: { ten: q, key, ma, limit } };
}
