'use server';

/**
 * Nguồn dữ liệu cho panel nhật ký gắn trong header của từng module (`NutNhatKy`).
 *
 * Vì sao là một server action chứ không đọc sẵn ở `page.tsx`: panel nằm trên 5 trang vận
 * hành, và hầu hết lượt mở trang KHÔNG mở panel. Đọc sẵn là mỗi lượt vào Kho hàng / Đóng
 * hàng / … phải trả thêm 1-2 câu quét `nhat_ky_thay_doi` cộng một câu tra `pg_trigger`,
 * cho một panel chưa ai bấm. Đọc khi bấm thì cái giá đó chỉ người soi log mới trả.
 *
 * Phân quyền KHÔNG nằm ở đây: `nhatKyCuaBang` tự gọi `requirePerm('view_nhat_ky')` và tự
 * che ô nhạy cảm theo vai trò của người đang xem (xem `queries.ts`). Ở đây chỉ chặn tên
 * bảng lạ — một server action là điểm vào công khai, nên tên bảng tới từ ngoài phải lọc
 * lại dù `nhatKyCuaBang` đã tham số hoá câu SQL.
 */
import { CAC_BANG, nhanBang } from '@/components/nhat-ky/bo-loc';
import type { KhoiNhatKy } from './gom-dong';
import { nhatKyCuaBang } from './queries';
import { trangThaiGhiCua } from './tra-trigger';
import { cauKhiTrong } from './trang-thai-ghi';

/**
 * Trần dòng thô MỖI BẢNG cho panel — thấp hơn trần 500 của `nhatKyCuaBang`.
 *
 * Panel là chỗ soi nhanh "ai vừa sửa gì ở màn này"; muốn lọc sâu thì có liên kết "Xem
 * đầy đủ" sang `/f/nhat-ky`. Một module soi hai bảng nên trần ở đây nhân đôi, và panel
 * mở ra trong lúc người ta đang làm việc dở — nó phải về nhanh hơn là về đủ.
 */
const GIOI_HAN_PANEL = 150;

export interface KetQuaPanel {
  khoi: KhoiNhatKy[];
  /** Câu hiện khi `khoi` rỗng — đã dứt khoát "chưa bật" / "đã bật" (xem `trang-thai-ghi.ts`). */
  cauTrong: string;
  /** Những bảng panel thật sự đọc được, sau khi lọc tên lạ — dùng dựng liên kết "Xem đầy đủ". */
  bang: Array<{ bang: string; nhan: string }>;
  /** Vai trò không có `view_nhat_ky`. Nói một câu, KHÔNG để lỗi ném ra làm sập màn module. */
  thieuQuyen?: boolean;
}

/**
 * Nhật ký của MỘT HOẶC NHIỀU bảng, gộp lại và sắp mới nhất trước.
 *
 * Gọi `nhatKyCuaBang` nhiều lượt rồi gộp, cố ý KHÔNG sửa chữ ký hàm đó thành nhận mảng:
 * câu SQL một bảng đi đúng chỉ mục `nhat_ky_thay_doi_bang_luc_idx`, còn một câu `IN (…)`
 * trộn hai bảng thì trần dòng cắt chung cho cả hai — bảng nào ồn ào hơn sẽ ăn hết trần và
 * đẩy bảng kia ra khỏi kết quả mà không ai thấy.
 */
export async function nhatKyChoPanel(bangYeuCau: readonly string[]): Promise<KetQuaPanel> {
  // Lọc tên lạ ngay tại biên, giữ nguyên thứ tự module khai (nó quyết thứ tự liên kết dưới panel).
  const bang = bangYeuCau.filter((b) => CAC_BANG.includes(b));
  const danhSachBang = bang.map((b) => ({ bang: b, nhan: nhanBang(b) }));

  try {
    const [theoBang, trangThai] = await Promise.all([
      Promise.all(bang.map((b) => nhatKyCuaBang(b, { gioiHan: GIOI_HAN_PANEL }))),
      trangThaiGhiCua(bang),
    ]);
    /* Sắp lại sau khi gộp: mỗi lượt đọc đã sắp giảm dần riêng, nhưng hai danh sách nối
       lại thì mốc thời gian đan xen nhau — không sắp là panel hiện thay đổi cũ của bảng
       thứ nhất lên trên thay đổi mới của bảng thứ hai. */
    const khoi = theoBang.flat().sort((a, b) => b.luc.getTime() - a.luc.getTime());
    return { khoi, cauTrong: cauKhiTrong(trangThai), bang: danhSachBang };
  } catch (e) {
    /* `requirePerm` ném đúng hai thông điệp này. Bắt THEO THÔNG ĐIỆP, không bắt mọi lỗi:
       một lỗi CSDL phải đi tiếp để panel nói "lỗi" thay vì vu cho người dùng là thiếu
       quyền — và để lỗi đó còn vào được log. */
    if (e instanceof Error && (e.message === 'Forbidden' || e.message === 'Unauthorized')) {
      return { khoi: [], cauTrong: '', bang: danhSachBang, thieuQuyen: true };
    }
    throw e;
  }
}
