/**
 * THUẦN: kiểm tra chuỗi nhân sự vừa dán vào ô mã vận đơn, trước khi action
 * (`luuTrackingChoKien` ở actions.ts) chạm tới CSDL.
 *
 * `dangDungOKienKhac` được TRA SẴN bởi caller (action, có DB) rồi truyền vào —
 * hàm này không tự query vì khi đó nó không còn THUẦN và test đơn vị phải mock
 * DB. Caller tự chịu trách nhiệm tra đúng: mã vừa bóc có thuộc MỘT KIỆN KHÁC
 * (không phải chính kiện đang nhập) hay không.
 *
 * Review Focus #4: khoá ghép của hệ thống là MÃ VẬN ĐƠN (Decisions dòng 511) —
 * hai kiện cùng một mã làm hỏng mọi phép nối theo tracking (đối soát hãng, ghi
 * ngược Lark, …). Vì vậy đây là bước CHẶN, không phải cảnh báo: trả `ok: false`
 * và action không được ghi gì khi gặp trường hợp này.
 */
import { macVanDonTu } from './ma-van-don';

export type KetQuaKiemTraTracking =
  | { ok: true; tracking: string }
  | { ok: false; loi: string };

export function kiemTraTracking(raw: string, dangDungOKienKhac: boolean): KetQuaKiemTraTracking {
  const tracking = macVanDonTu(raw);
  if (!tracking) {
    return {
      ok: false,
      loi: 'Không nhận ra mã vận đơn trong chuỗi vừa dán — dán nguyên mã vận đơn hoặc link theo dõi của hãng.',
    };
  }

  // Kiểm trùng kiện SAU khi bóc mã thành công: bóc sai thì chưa có mã nào để
  // tra trùng, báo lỗi "không bóc được" trước mới đúng thứ tự người dùng cần sửa.
  if (dangDungOKienKhac) {
    return { ok: false, loi: 'Mã vận đơn này đã thuộc kiện khác — kiểm tra lại trước khi dán sang kiện này.' };
  }

  return { ok: true, tracking };
}
