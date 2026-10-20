/**
 * Đọc nhật ký thay đổi cho hai màn hình của spec §6.
 *
 * Chỗ DUY NHẤT đọc bảng `nhat_ky_thay_doi`, và cũng là chỗ duy nhất quyết người đang xem
 * có những quyền gì. Luật gom và luật che nằm ở `gom-dong.ts` / `che-gia-tri.ts` (có
 * test); ở đây chỉ còn SQL + lắp danh tính.
 */
import { and, asc, count, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { getRole } from '@/lib/auth/role';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { QUYEN_DO_NHAY } from './che-gia-tri';
import { gomKhoi, type DongTho, type KhoiNhatKy } from './gom-dong';

/**
 * Trần số DÒNG THÔ mỗi lượt đọc. Một lượt bấm sinh 3-4 dòng nên 500 dòng ≈ 150 hành động
 * — đủ cho một màn hình, và `nhat_ky_thay_doi` là bảng chỉ dài ra: truy vấn không trần
 * trên bảng đó là một ngày nào đó kéo cả năm lịch sử về RAM của tiến trình web.
 *
 * Trần đếm theo DÒNG THÔ, nên khi chạm trần thì khối CŨ NHẤT trong kết quả có thể thiếu
 * vài trường (mép trần cắt giữa một khối). Chấp nhận: khối đó là khối cũ nhất của trang,
 * người đọc đang nhìn phần mới. Nếu sau này cần đúng tuyệt đối thì phân trang theo `luc`
 * chứ đừng nâng trần.
 */
const TRAN_DONG = 500;

function gioiHanAnToan(gioiHan?: number): number {
  if (!gioiHan || !Number.isFinite(gioiHan) || gioiHan <= 0) return TRAN_DONG;
  return Math.min(Math.trunc(gioiHan), TRAN_DONG);
}

/**
 * Quyền của NGƯỜI ĐANG XEM, dùng để che giá trị nhạy cảm.
 *
 * Cố ý KHÔNG nhận quyền từ đối số: người gọi (một `page.tsx`) mà truyền sai danh sách là
 * mở toang giá vốn cho cả công ty, và không test nào bắt được vì hàm vẫn "chạy đúng".
 * Danh tính chỉ đọc từ phiên đăng nhập, ngay tại đây.
 *
 * `requirePerm` ném `Forbidden` khi thiếu `view_nhat_ky` — mọi vai trò đều được cấp quyền
 * này (CEO 20/10/2026), nên lỗi đó nghĩa là vai trò chưa được seed, không phải chặn ai.
 */
async function quyenNguoiXem(): Promise<Permission[]> {
  const userId = await requirePerm('view_nhat_ky');
  const role = await getRole(userId);
  return QUYEN_DO_NHAY.filter((p) => hasPermission(role, p));
}

/** Cột chọn cho mọi truy vấn + tên người, nối từ bảng `user` lúc ĐỌC: nhật ký chỉ giữ id
 *  người làm bằng chứng (`tac-nhan.ts`), tên thì người ta đổi được. */
const COT = {
  bang: schema.nhatKyThayDoi.bang,
  banGhiId: schema.nhatKyThayDoi.banGhiId,
  truong: schema.nhatKyThayDoi.truong,
  truoc: schema.nhatKyThayDoi.truoc,
  sau: schema.nhatKyThayDoi.sau,
  tacNhanId: schema.nhatKyThayDoi.tacNhanId,
  nhanMay: schema.nhatKyThayDoi.tacNhanNhan,
  tenNguoi: schema.user.name,
  luc: schema.nhatKyThayDoi.luc,
};

type HangTho = {
  bang: string; banGhiId: string; truong: string;
  truoc: string | null; sau: string | null;
  tacNhanId: string | null; nhanMay: string | null; tenNguoi: string | null;
  luc: Date;
};

/** Nhãn MÁY thắng tên người: dòng của cron không có id người, và dòng của người không có
 *  nhãn máy (xem `nhanTacNhan`), nên hai ô này không bao giờ cùng có giá trị. */
function thanhDongTho(r: HangTho): DongTho {
  return {
    bang: r.bang,
    banGhiId: r.banGhiId,
    truong: r.truong,
    truoc: r.truoc,
    sau: r.sau,
    tacNhanId: r.tacNhanId,
    tacNhanNhan: r.nhanMay ?? r.tenNguoi ?? null,
    luc: r.luc,
  };
}

/**
 * Lịch sử của MỘT bản ghi — tab "Lịch sử" trên màn chi tiết.
 *
 * CUỐN CẢ DÒNG CON (spec §6): lấy cả dòng của chính bản ghi (`bang` + `ban_ghi_id`) VÀ
 * dòng mà trigger đã ghi sẵn bản ghi cha (`cha_bang` + `cha_id`). Việc QC xảy ra ở
 * `goods_receipt_items` (từng chiếc) nhưng thứ người ta mở là LÔ NHẬP KHO
 * (`goods_receipts`) — không cuốn lên thì tab Lịch sử của một lô gần như trống và câu
 * "ai QC lô nhập kho hôm nay" không trả lời được ở đúng lối vào CEO dùng nhiều nhất.
 *
 * Mỗi khối mang `banGhiId` riêng nên màn hình chỉ ra được đổi ở chính lô hay ở chiếc nào.
 * Hai nhánh `OR` đi vào đúng hai chỉ mục `nhat_ky_thay_doi_ban_ghi_idx` và `..._cha_idx`.
 */
export async function nhatKyCuaBanGhi(
  bang: string,
  banGhiId: string,
  gioiHan?: number,
): Promise<KhoiNhatKy[]> {
  const quyen = await quyenNguoiXem();
  const rows = await db.select(COT)
    .from(schema.nhatKyThayDoi)
    .leftJoin(schema.user, eq(schema.user.id, schema.nhatKyThayDoi.tacNhanId))
    .where(or(
      and(eq(schema.nhatKyThayDoi.bang, bang), eq(schema.nhatKyThayDoi.banGhiId, banGhiId)),
      and(eq(schema.nhatKyThayDoi.chaBang, bang), eq(schema.nhatKyThayDoi.chaId, banGhiId)),
    ))
    .orderBy(desc(schema.nhatKyThayDoi.luc), asc(schema.nhatKyThayDoi.truong))
    .limit(gioiHanAnToan(gioiHan));
  return gomKhoi(rows.map(thanhDongTho), quyen);
}

/** Bộ lọc của trang nhật ký cả bảng. Ô nào bỏ trống thì không lọc theo ô đó. */
export interface LocNhatKy {
  /** id người sửa. Dòng của máy có `tac_nhan_id` NULL nên lọc theo người sẽ loại chúng ra. */
  tacNhanId?: string;
  /** Tên cột THẬT (`qc_result`), không phải nhãn tiếng Việt. */
  truong?: string;
  tuNgay?: Date;
  denNgay?: Date;
  gioiHan?: number;
}

/**
 * Nhật ký của cả một bảng — trả lời "hôm nay ai sửa gì trong kho" (spec §6b).
 *
 * `bang` là tham số BẮT BUỘC, không có chế độ "mọi bảng": quét cả bảng nhật ký không có
 * điều kiện `bang` là bỏ qua `nhat_ky_thay_doi_bang_luc_idx`, và trang đó cũng không đọc
 * nổi khi mọi bảng trộn lẫn.
 */
export async function nhatKyCuaBang(bang: string, loc: LocNhatKy = {}): Promise<KhoiNhatKy[]> {
  const quyen = await quyenNguoiXem();
  const dieuKien = [eq(schema.nhatKyThayDoi.bang, bang)];
  if (loc.tacNhanId) dieuKien.push(eq(schema.nhatKyThayDoi.tacNhanId, loc.tacNhanId));
  if (loc.truong) dieuKien.push(eq(schema.nhatKyThayDoi.truong, loc.truong));
  if (loc.tuNgay) dieuKien.push(gte(schema.nhatKyThayDoi.luc, loc.tuNgay));
  if (loc.denNgay) dieuKien.push(lte(schema.nhatKyThayDoi.luc, loc.denNgay));
  const rows = await db.select(COT)
    .from(schema.nhatKyThayDoi)
    .leftJoin(schema.user, eq(schema.user.id, schema.nhatKyThayDoi.tacNhanId))
    .where(and(...dieuKien))
    .orderBy(desc(schema.nhatKyThayDoi.luc), asc(schema.nhatKyThayDoi.truong))
    .limit(gioiHanAnToan(loc.gioiHan));
  return gomKhoi(rows.map(thanhDongTho), quyen);
}

/**
 * Số dòng CHƯA GẮN DANH TÍNH theo bảng — món nợ của Task 4 hiện thành con số.
 *
 * Mỗi dòng ở đây là một thay đổi mà không ai biết ai làm: lệnh ghi đó không đi qua
 * `ghiVoi()` (cron cũ, script, `psql` gõ tay). Để con số này trên màn hình thay vì trong
 * một tệp kế hoạch là cách duy nhất để nó không bị quên; CỐ Ý không gõ cứng một con số
 * mục tiêu nào, chỉ đếm cái đang có.
 */
export async function demChuaGanDanhTinh(): Promise<Array<{ bang: string; soDong: number }>> {
  await requirePerm('view_nhat_ky');
  const rows = await db.select({ bang: schema.nhatKyThayDoi.bang, soDong: count() })
    .from(schema.nhatKyThayDoi)
    .where(and(
      isNull(schema.nhatKyThayDoi.tacNhanId),
      isNull(schema.nhatKyThayDoi.tacNhanNhan),
    ))
    .groupBy(schema.nhatKyThayDoi.bang)
    .orderBy(desc(count()));
  return rows.map((r) => ({ bang: r.bang, soDong: Number(r.soDong) }));
}
