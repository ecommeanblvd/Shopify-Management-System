import { kiemDongLoi, type LyDoLoi } from './loi-qc';

export type KetQuaQc = 'pending' | 'pass' | 'fail';

/**
 * THUẦN: QC chỉ chạy MỘT LẦN cho một chiếc.
 *
 * Đã `pass` là hàng đã vào tồn qua `applyMovement`; cho QC lại là nhập đôi hoặc
 * trừ tồn của chiếc đã bán. Muốn sửa thì phải đi đường điều chỉnh tồn riêng.
 */
export function chuyenDuocQc(tu: KetQuaQc): boolean {
  return tu === 'pending';
}

/**
 * THUẦN: quản lý có ĐỔI LẠI được kết quả QC đã chốt không (CEO 14/10/2026).
 *
 * Vì sao cần: nhân sự bấm nhầm "không đạt", hoặc kiểm lại thì thấy vẫn dùng được. Trước đây
 * QC là một chiều tuyệt đối (`chuyenDuocQc` chỉ cho `pending → …`), nên cách duy nhất là sửa
 * tay trong CSDL.
 *
 * Hai chiều KHÔNG đối xứng:
 *   - `fail → pass`: luôn cho. Hàng lỗi chưa bao giờ vào tồn, đổi lại chỉ là nhập nó vào.
 *   - `pass → fail`: chỉ khi hàng CHƯA ĐI. Chiếc đã gửi sang Mỹ thì bấm "không đạt" không
 *     kéo nó về được, mà trừ tồn một chiếc không còn ở đó là làm sổ kho sai thêm. CEO chốt
 *     14/10: hàng đã đi thì khoá, còn lại thì cho.
 *
 * "Đã đi" đọc ở TRẠNG THÁI DÒNG HÀNG, không phải ở việc kiện có mã vận đơn. Đo 14/10/2026:
 * 344 chiếc `allocated` đều có dòng fulfillment nhưng KHÔNG dòng nào gắn với kiện có mã vận
 * đơn, trong khi 311 dòng trong số đó đã ở trạng thái `shipped`. Hệ thống ghi "hàng đã đi" ở
 * dòng hàng; lấy mã vận đơn làm thước là khoá nhầm gần như không ai.
 *
 * Bằng chứng lỗi cũ (`wh_loi_qc`: ảnh + lý do) KHÔNG BAO GIỜ bị xoá khi đổi sang đạt — CEO
 * chốt giữ để đối chiếu về sau. Việc đó thuộc hàm gọi, ghi ở đây để không ai "dọn" nhầm.
 */
export function doiDuocKetQuaQc(v: {
  tu: KetQuaQc; den: 'pass' | 'fail'; stockStatus: string | null; lineStatus: string | null;
}): { ok: true } | { ok: false; loi: string } {
  if (v.tu === 'pending') {
    return { ok: false, loi: 'Chiếc này chưa kiểm — dùng màn QC để kiểm lần đầu.' };
  }
  if (v.tu === v.den) {
    return { ok: false, loi: `Chiếc này đã ở trạng thái ${v.den === 'pass' ? 'ĐẠT' : 'KHÔNG ĐẠT'} rồi.` };
  }
  if (v.den === 'pass') return { ok: true };
  // pass → fail
  if (v.stockStatus === 'shipped' || v.lineStatus === 'shipped') {
    return { ok: false, loi: 'Chiếc này đã gửi đi rồi — không đổi được sang KHÔNG ĐẠT. Hàng đã đi mà lỗi thì xử bằng khiếu nại với brand.' };
  }
  // Đang giữ cho một đơn: nhả hàng khỏi đơn là việc của thủ tục cấp phát (nó còn tính lại
  // reserved trên sổ tồn và rollup của dòng hàng). Gọi lẻ một nửa ở đây là để sổ kho lệch,
  // nên CHẶN và chỉ đường, thay vì tự làm nửa vời.
  if (v.stockStatus === 'allocated' || v.stockStatus === 'staging') {
    return { ok: false, loi: 'Chiếc này đang được giữ cho một đơn — gỡ khỏi đơn trước, rồi đổi kết quả QC.' };
  }
  return { ok: true };
}

/**
 * THUẦN: chiếc ở trạng thái này có THÊM được dòng lỗi (bổ sung bằng chứng) không.
 *
 * Chỉ `fail`. Thêm lỗi cho chiếc `pass` là ghi bằng chứng lỗi vào hàng ĐÃ VÀO TỒN — hai sự thật
 * ngược nhau trên cùng một chiếc, và không có đường nào rút hàng ra. Chiếc `pending` phải đi
 * `qcKhongDat` để trạng thái và Lark được cập nhật; thêm lỗi suông là chiếc vẫn nằm "chờ QC"
 * trong khi hồ sơ lỗi đã có — đúng kiểu dữ liệu nói một đằng, trạng thái nói một nẻo.
 *
 * Trả LÝ DO khác nhau cho hai ca: "chưa kiểm" cần người bấm Kiểm, "đã đạt" là bế tắc thật.
 */
export function themDuocLoi(qc: KetQuaQc): { ok: true } | { ok: false; loi: string } {
  if (qc === 'fail') return { ok: true };
  return { ok: false, loi: qc === 'pending'
    ? 'Chiếc này chưa kiểm — bấm Kiểm để ghi lỗi.'
    : 'Chiếc này đã kiểm ĐẠT — không thêm được lỗi.' };
}

export interface DongLoiVao { lyDo: LyDoLoi; anhKey: string | null; ghiChu: string }

export function kiemLoQc(dong: readonly DongLoiVao[]):
  | { ok: true } | { ok: false; loi: string } {
  if (dong.length === 0) return { ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' };
  for (let i = 0; i < dong.length; i++) {
    const r = kiemDongLoi(dong[i]!);
    if (!r.ok) return { ok: false, loi: `Chỗ lỗi ${i + 1}: ${r.loi}` };
  }
  return { ok: true };
}

/**
 * MỘT chỗ lỗi như người kiểm nhập trên màn hình: một lý do, một ghi chú, NHIỀU ảnh.
 *
 * Bảo báo 09/10/2026: "không thể cho nhiều ảnh vào 1 lỗi (ví dụ cùng 1 lỗi bẩn nhưng nhiều
 * chỗ)". Trước đó mỗi chỗ lỗi đúng MỘT ô ảnh, nên muốn hai tấm cho cùng vết bẩn thì phải bấm
 * "+ Thêm chỗ lỗi" rồi chọn lại đúng lý do đó — đọc trên màn hình ra "hai lỗi Bẩn".
 */
export interface ChoLoiNhap { lyDo: LyDoLoi; ghiChu: string; anhKey: readonly (string | null)[] }

/**
 * THUẦN: trải mỗi chỗ lỗi thành các dòng `wh_loi_qc` — vẫn MỘT DÒNG MỘT ẢNH.
 *
 * Vì sao KHÔNG đổi bảng thành `anh_key[]`: một dòng = một bằng chứng (lý do + ảnh + ghi chú) là
 * hình dạng cả đường ghi đang dựa vào — `moTaLoiQc` gộp trùng lý do nên hai dòng "Bẩn" vẫn in ra
 * một chữ "Bẩn" trên Lark, và `anhLoiQcTheoChiec` cần từng ảnh đi kèm nhãn lý do để vẽ ô trên
 * bảng. Chỗ thiếu nằm ở MÀN HÌNH, không nằm ở bảng; đổi bảng là sửa chỗ không hỏng rồi kéo theo
 * cả đường đẩy Lark và lượt bù dữ liệu cũ.
 *
 * Chỗ lỗi CHƯA có ảnh nào vẫn ra một dòng (ảnh thôi bắt buộc từ 01/10/2026 — xem `kiemDongLoi`).
 * Bỏ nó đi là mất luôn lý do lỗi người kiểm đã gõ.
 */
export function moRongDongLoi(cho: readonly ChoLoiNhap[]): DongLoiVao[] {
  const ra: DongLoiVao[] = [];
  for (const c of cho) {
    const anh = c.anhKey.filter((k): k is string => typeof k === 'string' && k !== '');
    if (anh.length === 0) { ra.push({ lyDo: c.lyDo, anhKey: null, ghiChu: c.ghiChu }); continue; }
    for (const k of anh) ra.push({ lyDo: c.lyDo, anhKey: k, ghiChu: c.ghiChu });
  }
  return ra;
}

/**
 * THUẦN: kiểm theo CHỖ LỖI, để số trong câu lỗi là số người kiểm đang thấy trên màn hình.
 *
 * Vì sao không dùng thẳng `kiemLoQc` sau khi trải: một chỗ lỗi có 2 ảnh thành 2 dòng, nên chỗ
 * lỗi thứ 3 trên màn hình lại bị báo là "Chỗ lỗi 4" — người kiểm đi sửa đúng dòng sai số.
 *
 * Luật của một dòng vẫn là `kiemDongLoi`, không viết lại ở đây: `kiemLoQc` (máy chủ) và hàm này
 * (màn hình) chỉ khác cách ĐẾM, không khác luật.
 */
export function kiemChoLoi(cho: readonly ChoLoiNhap[]):
  | { ok: true } | { ok: false; loi: string } {
  if (cho.length === 0) return { ok: false, loi: 'Phải ghi ít nhất một chỗ lỗi.' };
  for (let i = 0; i < cho.length; i++) {
    const c = cho[i]!;
    const r = kiemDongLoi({ lyDo: c.lyDo, anhKey: null, ghiChu: c.ghiChu });
    if (!r.ok) return { ok: false, loi: `Chỗ lỗi ${i + 1}: ${r.loi}` };
  }
  return { ok: true };
}
