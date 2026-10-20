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
 *
 * Hàm này KHÔNG BAO GIỜ ném: mọi lỗi thành chữ trong `KetQuaPanel`. Lý do ở `nhatKyChoPanel`.
 */
import { CAC_BANG, nhanBang } from '@/components/nhat-ky/bo-loc';
import type { KhoiNhatKy } from './gom-dong';
import { nhatKyCuaBang } from './queries';
import { trangThaiGhiCua } from './tra-trigger';
import { cauKhiTrong, CAU_KHONG_TRA_DUOC } from './trang-thai-ghi';

/**
 * Trần dòng thô MỖI BẢNG cho panel — thấp hơn trần 500 của `nhatKyCuaBang`.
 *
 * Panel là chỗ soi nhanh "ai vừa sửa gì ở màn này"; muốn lọc sâu thì có liên kết "Xem
 * đầy đủ" sang `/f/nhat-ky`. Một module soi hai bảng nên trần ở đây nhân đôi, và panel
 * mở ra trong lúc người ta đang làm việc dở — nó phải về nhanh hơn là về đủ.
 *
 * KHÔNG export: tệp `'use server'` chỉ được export hàm async, nên con số đi ra ngoài bằng
 * `KetQuaPanel.gioiHan` — vẫn một nguồn duy nhất, mà màn hình không phải gõ lại 150.
 */
const GIOI_HAN_PANEL = 150;

export interface KetQuaPanel {
  khoi: KhoiNhatKy[];
  /** Câu hiện khi `khoi` rỗng — đã dứt khoát "chưa bật" / "đã bật" (xem `trang-thai-ghi.ts`). */
  cauTrong: string;
  /** Những bảng panel thật sự đọc được, sau khi lọc tên lạ — dùng dựng liên kết "Xem đầy đủ". */
  bang: Array<{ bang: string; nhan: string }>;
  /**
   * Nhãn những bảng ĐỌC LỖI. Panel phải nói ra: danh sách còn lại trông vẫn bình thường,
   * nên im lặng là để người đọc kết luận "bảng này không có thay đổi nào" từ một lượt đọc
   * đã hỏng mất một nửa.
   */
  bangLoi: string[];
  /** Có bảng nào chạm trần `GIOI_HAN_PANEL` — tức còn thay đổi cũ hơn mà panel không hiện. */
  chamTran: boolean;
  /** Chính trần đang áp (dòng thô mỗi bảng) — để màn hình nói ra con số thật, không gõ lại. */
  gioiHan: number;
  /** Vai trò không có `view_nhat_ky`. Nói một câu, KHÔNG để lỗi ném ra làm sập màn module. */
  thieuQuyen?: boolean;
}

/** `requirePerm` ném đúng hai thông điệp này. So THEO THÔNG ĐIỆP để một lỗi CSDL không bị
 *  vu thành "thiếu quyền" — người dùng sẽ đi xin quyền cho một lỗi hạ tầng. */
function laThieuQuyen(e: unknown): boolean {
  return e instanceof Error && (e.message === 'Forbidden' || e.message === 'Unauthorized');
}

/** Số DÒNG THÔ mà một lượt đọc trả về: `gomKhoi` giữ một `dong` cho mỗi dòng thô, nên tổng
 *  này so được trực tiếp với trần — `khoi.length` thì không (một khối gộp nhiều dòng). */
function soDongTho(khoi: readonly KhoiNhatKy[]): number {
  return khoi.reduce((s, k) => s + k.dong.length, 0);
}

/**
 * Nhật ký của MỘT HOẶC NHIỀU bảng, gộp lại và sắp mới nhất trước.
 *
 * Gọi `nhatKyCuaBang` nhiều lượt rồi gộp, cố ý KHÔNG sửa chữ ký hàm đó thành nhận mảng:
 * câu SQL một bảng đi đúng chỉ mục `nhat_ky_thay_doi_bang_luc_idx`, còn một câu `IN (…)`
 * trộn hai bảng thì trần dòng cắt chung cho cả hai — bảng nào ồn ào hơn sẽ ăn hết trần và
 * đẩy bảng kia ra khỏi kết quả mà không ai thấy.
 *
 * `allSettled`, không `all`: ba module soi HAI bảng, và với `all` thì một bảng lỗi là mất
 * luôn cả phần đọc được của bảng kia — panel trống trơn đúng lúc người ta cần nó nhất.
 * Phần đọc được hiện ra, phần lỗi gọi tên ở `bangLoi`.
 *
 * Lượt tra `pg_trigger` cũng được bọc: nó chỉ quyết CÂU CHỮ khi trống, nên để nó làm đổ cả
 * panel là đánh đổi ngược hẳn.
 */
export async function nhatKyChoPanel(bangYeuCau: readonly string[]): Promise<KetQuaPanel> {
  // Lọc tên lạ ngay tại biên, giữ nguyên thứ tự module khai (nó quyết thứ tự liên kết dưới panel).
  const bang = bangYeuCau.filter((b) => CAC_BANG.includes(b));
  const danhSachBang = bang.map((b) => ({ bang: b, nhan: nhanBang(b) }));

  const [kqDoc, trangThai] = await Promise.all([
    Promise.allSettled(bang.map((b) => nhatKyCuaBang(b, { gioiHan: GIOI_HAN_PANEL }))),
    trangThaiGhiCua(bang).catch((e: unknown) => {
      console.error('[nhat-ky] tra pg_trigger lỗi:', e);
      return null;
    }),
  ]);

  /* Thiếu quyền là chuyện của NGƯỜI, không của bảng: mọi lượt đọc đều đi qua cùng một
     `requirePerm`, nên nó rớt thì rớt hết. Chỉ kết luận khi MỌI lượt rớt vì đúng lý do đó —
     một bảng lỗi CSDL lẫn vào thì đây là lỗi đọc, không phải thiếu quyền. */
  if (bang.length > 0 && kqDoc.every((k) => k.status === 'rejected' && laThieuQuyen(k.reason))) {
    return {
      khoi: [], cauTrong: '', bang: danhSachBang, bangLoi: [],
      chamTran: false, gioiHan: GIOI_HAN_PANEL, thieuQuyen: true,
    };
  }

  const khoi: KhoiNhatKy[] = [];
  const bangLoi: string[] = [];
  let chamTran = false;
  kqDoc.forEach((k, i) => {
    if (k.status === 'fulfilled') {
      khoi.push(...k.value);
      if (soDongTho(k.value) >= GIOI_HAN_PANEL) chamTran = true;
    } else {
      console.error(`[nhat-ky] đọc bảng ${bang[i]} lỗi:`, k.reason);
      bangLoi.push(danhSachBang[i].nhan);
    }
  });

  /* Sắp lại sau khi gộp: mỗi lượt đọc đã sắp giảm dần riêng, nhưng hai danh sách nối lại
     thì mốc thời gian đan xen nhau — không sắp là panel hiện thay đổi cũ của bảng thứ nhất
     lên trên thay đổi mới của bảng thứ hai. */
  khoi.sort((a, b) => b.luc.getTime() - a.luc.getTime());

  return {
    khoi,
    cauTrong: trangThai === null ? CAU_KHONG_TRA_DUOC : cauKhiTrong(trangThai),
    bang: danhSachBang,
    bangLoi,
    chamTran,
    gioiHan: GIOI_HAN_PANEL,
  };
}
