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
import { hangTheoMaVanDon } from '@/lib/ma-van-don';
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

/**
 * THUẦN: cảnh báo khi DẠNG mã vừa dán chỉ ra một hãng KHÁC với hãng của kiện.
 *
 * `macVanDonTu` nhận MỌI chuỗi 8–35 ký tự chữ-số, nên mã đơn, mã SKU, mã kiện, hay nhãn của
 * kiện BÊN CẠNH đều qua được. `hangTheoMaVanDon` đã nhận hãng theo dạng mã (FedEx 12 số, DHL
 * 10, Aramex 11, UPS 1Z+16 — tách bạch, kiểm trên 6.100 mã) và `lay-gia-uoc-tinh.ts` đã dùng
 * nó để suy hãng, nhưng CHƯA AI so nó với `shipments.carrier_key`. Hai bên lệch chính là dấu
 * hiệu dán nhầm dòng — mà dán nhầm thì nhân sự không có đường tự sửa (action chặn ghi đè mã
 * khác), phải vào DB + vào Lark xoá tay.
 *
 * CẢNH BÁO, KHÔNG CHẶN: dạng mã có thể trùng khuôn (một mã DHL 10 số hợp lệ vẫn có thể là mã
 * thật của kiện đi hãng khác trong tương lai), và `carrier_key` cũng do người điền nên không
 * phải sự thật tuyệt đối. Chặn cứng ở đây là khoá nhân sự khỏi một thao tác có thể đúng.
 *
 * `null` khi không có gì để nói: dạng mã lạ (không suy ra hãng), kiện chưa có hãng, hoặc khớp.
 */
export function canhBaoLechHang(tracking: string, carrierKey: string | null): string | null {
  const theoMa = hangTheoMaVanDon(tracking);
  if (!theoMa || !carrierKey || theoMa === carrierKey) return null;
  return `dạng mã ${tracking} là mã ${theoMa.toUpperCase()}, nhưng kiện này ghi hãng ${carrierKey.toUpperCase()} — kiểm lại xem có dán nhầm dòng không`;
}
