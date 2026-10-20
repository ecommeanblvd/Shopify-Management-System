/**
 * Gom dòng nhật ký thô thành KHỐI để hiện lên màn hình (spec §6).
 *
 * Trigger ghi MỘT DÒNG MỖI CỘT, nên một lượt bấm "Đạt" sinh ra 3-4 dòng rời. Hiện thẳng
 * danh sách thô thì người đọc thấy ba dòng giống nhau và không biết đó là một hành động
 * hay ba; gom lại thành "lúc 10:03, Đức sửa 3 trường" mới đúng cái đã xảy ra.
 *
 * Thuần, không I/O: `queries.ts` lo phần SQL. Tách ra vì luật gom (gom theo
 * người-lúc-bản ghi, mới nhất trước) và luật che là hai thứ `vitest` kiểm được, còn một
 * câu SQL thì không.
 */
import type { Permission } from '@/lib/auth/rbac';
import { cheNeuCan } from './che-gia-tri';
import { nhanCot } from './nhan-cot';

/** Dòng thô đọc từ `nhat_ky_thay_doi`. `tacNhanNhan` đã được `queries.ts` điền sẵn tên
 *  người (hoặc nhãn máy) — bảng nhật ký chỉ giữ id người, tên tra lúc đọc. */
export interface DongTho {
  bang: string;
  banGhiId: string;
  truong: string;
  truoc: string | null;
  sau: string | null;
  tacNhanId: string | null;
  tacNhanNhan: string | null;
  luc: Date;
}

/** Một ô đã đổi, sau khi áp phân quyền. `biChe` nói rõ vì sao `truoc`/`sau` rỗng. */
export interface DongNhatKy {
  truong: string;
  nhan: string;
  truoc: string | null;
  sau: string | null;
  biChe: boolean;
}

/** Một hành động: cùng người, cùng thời điểm, cùng bản ghi. */
export interface KhoiNhatKy {
  luc: Date;
  tacNhanId: string | null;
  tacNhanNhan: string;
  banGhiId: string;
  dong: DongNhatKy[];
}

/**
 * Nhãn cho dòng mà trigger không nhận được danh tính (cron cũ, `psql` gõ tay — xem
 * `ghi-voi.ts`). NÓI RÕ là chưa gắn, không để trống và cũng không đoán là "Hệ thống":
 * đây là MÓN NỢ nhìn thấy được, `demChuaGanDanhTinh()` đếm đúng những dòng này.
 */
export const CHUA_GAN_DANH_TINH = 'Chưa gắn danh tính';

/**
 * Nhãn người/máy hiện lên màn hình. Không bao giờ rỗng — ô trống ở cột "Người dùng" làm
 * người đọc tưởng dòng log bị hỏng.
 *
 * Còn id mà không có tên = người đã bị xoá khỏi bảng `user`, hoặc tra không ra. Hiện
 * chính id thì xấu nhưng vẫn truy được; gọi là "Chưa gắn danh tính" thì SAI — danh tính
 * có gắn, và con số nợ ở `demChuaGanDanhTinh()` sẽ không khớp với cái màn hình nói.
 */
function nhanTacNhanHienThi(tacNhanId: string | null, tacNhanNhan: string | null): string {
  if (tacNhanNhan) return tacNhanNhan;
  if (tacNhanId) return tacNhanId;
  return CHUA_GAN_DANH_TINH;
}

/** `\u0000` không có trong uuid/tên bảng/ISO date nên không khoá nào trùng khoá khác. */
function khoaKhoi(r: DongTho): string {
  return [r.bang, r.banGhiId, r.tacNhanId ?? '', r.tacNhanNhan ?? '', r.luc.getTime()].join('\u0000');
}

/**
 * Áp phân quyền cho một ô.
 *
 * Ruling 1 của kế hoạch 20/10/2026: `biChe` là MỘT cờ cho cả hai đầu — che một trong hai
 * thì che CẢ HAI. Cùng một cột thì độ nhạy ở hai đầu như nhau, che `sau` mà để lộ `truoc`
 * là vô nghĩa.
 */
function apQuyen(r: DongTho, quyen: readonly Permission[]): DongNhatKy {
  const t = cheNeuCan(r.bang, r.truong, r.truoc, quyen);
  const s = cheNeuCan(r.bang, r.truong, r.sau, quyen);
  const biChe = t.biChe || s.biChe;
  return {
    truong: r.truong,
    nhan: nhanCot(r.bang, r.truong),
    truoc: biChe ? null : t.gia,
    sau: biChe ? null : s.gia,
    biChe,
  };
}

/**
 * Gom dòng thô thành khối, MỚI NHẤT TRƯỚC.
 *
 * Gom theo **bảng + bản ghi + người + thời điểm**. Phải có cả `bang` trong khoá vì
 * `nhatKyCuaBanGhi` trộn dòng của bản ghi cha với dòng của dòng con, và hai bảng khác
 * nhau vẫn có thể trùng `banGhiId`. Phải có cả người vì hai người sửa đúng một giây trên
 * cùng bản ghi là hai hành động — gộp lại là gán việc của người này cho người kia.
 *
 * Thời điểm so bằng dấu giờ CHÍNH XÁC, và điều đó hoạt động được vì `nhat_ky_thay_doi.luc`
 * mặc định `now()` — dấu giờ của GIAO DỊCH, không phải `clock_timestamp()`. Mọi dòng của
 * một lượt ghi (và của cả giao dịch mà `ghiVoi()` mở) có cùng `luc`, nên một lượt bấm là
 * một khối dù trigger chạy nhiều lệnh.
 *
 * Cố ý KHÔNG gom theo cửa sổ thời gian ±n giây: cửa sổ thì hai lượt sửa liên tiếp của
 * cùng một người nhập thành một khối, và "sửa hai lần" khác "sửa một lần" khi đang đi tìm
 * ai làm gì.
 */
export function gomKhoi(rows: readonly DongTho[], quyen: readonly Permission[]): KhoiNhatKy[] {
  const theoKhoa = new Map<string, KhoiNhatKy>();
  for (const r of rows) {
    const khoa = khoaKhoi(r);
    let khoi = theoKhoa.get(khoa);
    if (!khoi) {
      khoi = {
        luc: r.luc,
        tacNhanId: r.tacNhanId,
        tacNhanNhan: nhanTacNhanHienThi(r.tacNhanId, r.tacNhanNhan),
        banGhiId: r.banGhiId,
        dong: [],
      };
      theoKhoa.set(khoa, khoi);
    }
    khoi.dong.push(apQuyen(r, quyen));
  }
  // Sắp lại ở đây chứ không chỉ dựa vào `ORDER BY` của SQL: `gomKhoi` là hàm công khai,
  // và một thứ tự sai thì màn hình hiện thay đổi cũ trên cùng mà không ai thấy lỗi.
  return [...theoKhoa.values()].sort((a, b) => b.luc.getTime() - a.luc.getTime());
}
