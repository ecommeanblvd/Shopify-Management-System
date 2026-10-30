/**
 * THUẦN: chữ hiện lên modal chi tiết báo lỗi. Tách khỏi component vì vitest **chỉ bắt
 * `.test.ts`, KHÔNG bắt `.test.tsx`** — logic nằm trong `.tsx` là logic không ai gác.
 */
import { NGUOI_TU_DONG } from './phan-loai';

/**
 * Nhãn cho một dòng trong dòng thời gian.
 *
 * Dòng của bot ghi **"ghi qua đường tự động"**, KHÔNG ghi "Hệ thống tự động": nhãn sau khẳng
 * định bot đã làm, mà đường `PATCH /api/issues` đóng cứng người thực hiện là bot nên có dòng
 * như thế thật ra do người làm tay (thiết kế §7). "Qua đường tự động" chỉ nói **đường ghi** —
 * đúng với dữ liệu đang có, và không vu cho ai.
 *
 * Người thật: hiện tên; `issue_report_events.nguoi` lưu email nên tra `ten` theo email để
 * không rải email đồng nghiệp ra màn hình.
 */
export function nhanNguoiSuKien(nguoi: string, ten: ReadonlyMap<string, string>): string {
  if (nguoi === NGUOI_TU_DONG) return 'ghi qua đường tự động';
  return ten.get(nguoi) ?? nguoi;
}

/** Câu đi kèm dòng thời gian, nói thẳng điều hệ thống KHÔNG biết. */
export const CAU_DUONG_TU_DONG = 'Đường tự động không ghi lại ai thực hiện.';

/**
 * Nhãn người báo. `issue_reports.reporter_id` là `on delete set null`, nên một báo lỗi cũ có
 * thể không tra ra tên — rơi về email, rồi về "ẩn danh". Không ném ở bất kỳ nhánh nào.
 */
export function nhanNguoiBao(a: { ten: string | null; email: string | null }): string {
  return a.ten?.trim() || a.email?.trim() || 'ẩn danh';
}

/**
 * Chỉ `https://` được render thành liên kết. `ghi_chu_xu_ly` và `pr_url` do tác vụ tự động ghi
 * qua API, nên coi chúng là dữ liệu ngoài — `javascript:` lọt vào `href` là XSS.
 */
export function laLienKetAnToan(url: string | null | undefined): boolean {
  return typeof url === 'string' && /^https:\/\//.test(url);
}

/** Câu thay cho hộp "Đã xử lý thế nào" khi chưa có ghi chú — mỗi trạng thái một câu riêng. */
export function cauChuaXuLy(trangThai: string): string {
  switch (trangThai) {
    case 'moi':
      return 'Chưa ai xử lý. Tác vụ tự động chạy mỗi đêm khoảng 1:41.';
    case 'dang_xu_ly':
      return 'Đang xử lý, chưa có ghi chú kết quả.';
    case 'cho_duyet':
      return 'Đã sửa xong và đang chờ duyệt bản vá.';
    case 'can_nguoi':
      return 'Cần người quyết: việc này phải có quyết định nghiệp vụ, không tự sửa được.';
    case 'da_xong':
      return 'Đã xong nhưng chưa ai ghi lại cách xử lý.';
    case 'tu_choi':
      return 'Đã xem và kết luận không phải lỗi.';
    default:
      return 'Chưa có ghi chú xử lý.';
  }
}
