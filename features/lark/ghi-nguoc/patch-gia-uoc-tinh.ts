/**
 * THUẦN: dựng bản vá Lark cho khối ô chi phí + mã vận đơn từ `GiaUocTinh` (Task 2).
 *
 * Luật "ô trống" dùng lại nguyên của `dung-patch.ts`: `oLarkTrong` làm LÁ CHẮN (chỉ ô vắng
 * mặt / chuỗi trim rỗng / mảng rỗng là trống; đọc không ra gì nghĩa là CÓ, đừng chạm) và
 * `docSo` chỉ để đọc số ra mà so. Một định nghĩa "trống" duy nhất cho cả hai đường ghi, vì
 * hai định nghĩa lệch nhau trên cùng một bảng Lark là loại lỗi không ai thấy bằng mắt.
 *
 * Hai luật "không ghi" bắt buộc, cùng một lý do (Lark chỉ cho điền thêm, không có undo — ghi
 * sai là người phải vào xoá tay từng ô và họ không còn bản gốc):
 *   - khoản `null` = "nguồn không nói gì" (xem gia-uoc-tinh.ts) → bỏ hẳn khỏi patch, KHÔNG
 *     quy về 0.
 *   - khoản `<= 0` → cũng bỏ hẳn, ĐÚNG luật `dung-patch.ts` (`if (moi == null || moi <= 0)
 *     continue`). Ghi `0` vào ô hãng THẬT SỰ có thu là khoá ô vĩnh viễn ở 0: `dungPatch` sau
 *     này đọc `docSo = 0 ≠ null` nên không bao giờ ghi được số hoá đơn thật vào đó nữa.
 *
 * `maLa` không có cột tương ứng trên Lark (chỉ để người nhập thấy khoản lạ) nên không ghi ở đây.
 */
import { larkText } from '../parse-pack-row';
import { docSo, oLarkTrong } from './dung-patch';
import { COT, COT_CHI_PHI, type KhoaCotChiPhi } from './cot';
import type { GiaUocTinh } from '@/features/dong-hang/gia-uoc-tinh';

type KhoanSo = 'base' | 'discount' | 'fuel' | 'remote' | 'demand' | 'signature' | 'residential' | 'importHandling' | 'vat' | 'total';

/** Khoá `COT_CHI_PHI` → tên trường `GiaUocTinh`. Tên lệch vì `COT_CHI_PHI` giữ tên gốc của
 *  `shipment_charges` (`directSignature`, `totalAmount`) còn `GiaUocTinh` dùng tên ngắn gọn
 *  chung cho mọi nguồn (`signature`, `total`).
 *
 *  Khai bằng MẢNG `as const satisfies` chứ không `Partial<Record<string, …>>`: kiểu khoá rộng
 *  không bắt được lỗi gõ sai tên khoá, và `COT_CHI_PHI[khoaCot]` khi đó trả `undefined` →
 *  patch mang khoá `"undefined"` lên Lark. PUT của Lark là all-or-nothing nên MỘT khoá sai
 *  chặn cả bản vá.
 *
 *  `gogreen` KHÔNG có ở đây dù Lark có cột `GoGreen Plus-Basic` và DHL có 3 dòng
 *  `per_step_fixed` GoGreen: `QuoteBreakdown` gộp chúng vào `perStep` cùng mọi dòng
 *  per_step khác, không tách riêng được khoản GoGreen ⇒ không biết con số ⇒ không ghi.
 *  `elevatedRisk` cũng vậy (nằm trong `countryFixed` của DHL).
 *
 *  `totalAmount` ("INS | Chi phí Tổng (đ)") CÓ map — đính chính của CEO: ô này xưa nay là
 *  TỔNG ƯỚC TÍNH nhân sự tự gõ tay sau khi tạo vận đơn, không phải số hoá đơn thật. Mục tiêu
 *  của tính năng chính là bỏ bước gõ tay đó (gồm cả tracking lẫn các giá dự tính, kể cả tổng);
 *  để trống ô tổng thì nhân sự vẫn phải mở Lark gõ một ô, coi như tính năng chưa xong việc.
 *
 *  `discountApi` ("Chiết khấu || API") là ô MỚI của CEO chốt 13/10/2026 — ô số, ghi được, KHÁC
 *  hẳn ô `Giá chiết khấu` (Formula của Lark, KHÔNG bao giờ ghi). Nó đi theo ĐÚNG luật ô trống
 *  như mọi khoản ở đây: `null` (UPS — Rating API không trả khoản chiết khấu nào) và `<= 0`
 *  (engine, vì `contract_discount_pct` hiện 0 dòng) đều KHÔNG ghi. Vì thế `GiaUocTinh.discount`
 *  phải là số DƯƠNG: theo quy ước ÂM của `shipment_charges.discount` thì mọi kiện đều rơi vào
 *  nhánh `<= 0` và ô này không bao giờ được điền, mà nhìn vào code thì tưởng là đã làm xong. */
const KHOAN_THEO_COT = [
  ['base', 'base'], ['discountApi', 'discount'],
  ['fuel', 'fuel'], ['remote', 'remote'], ['demand', 'demand'],
  ['directSignature', 'signature'], ['residential', 'residential'], ['importHandling', 'importHandling'],
  ['vat', 'vat'], ['totalAmount', 'total'],
] as const satisfies ReadonlyArray<readonly [KhoaCotChiPhi, KhoanSo]>;

export interface KetQuaPatchGiaUocTinh {
  patch: Record<string, unknown>;
  /** Việc người đọc PHẢI biết dù patch đã ghi xong — ô Lark đang giữ một mã vận đơn khác,
   *  ô có dữ liệu không đọc được, không còn ô trống nào để điền… Im lặng ở những ca này là
   *  để thao tác của nhân sự bốc hơi mà toast vẫn báo xanh. */
  canhBao: string[];
}

export function patchGiaUocTinh(
  g: GiaUocTinh, oHienCo: Record<string, unknown>, tracking: string | null,
): KetQuaPatchGiaUocTinh {
  const patch: Record<string, unknown> = {};
  const canhBao: string[] = [];
  const daCoSan: string[] = [];

  for (const [khoaCot, khoaGia] of KHOAN_THEO_COT) {
    const cot = COT_CHI_PHI[khoaCot];
    const tho = g[khoaGia];
    if (tho == null) continue; // không biết — không quy về 0
    /* Làm tròn TRƯỚC khi xét `<= 0`: mọi cột tiền trên Lark là VND, mà quy đổi tiền có thể ra
     * số thập phân (đo thật: tổng 1.877.160,2). Và một khoản 0,3đ sau khi tròn thành 0 thì
     * đúng là "không có gì để ghi" — ghi 0 vào đó là khoá ô ở 0 vĩnh viễn. */
    const moi = Math.round(tho);
    if (moi <= 0) {
      if (khoaCot === 'totalAmount') canhBao.push(`tổng ước tính ra ${moi} (≤ 0) — không ghi lên ô Tổng`);
      continue;
    }
    if (!oLarkTrong(oHienCo[cot])) {
      const cu = docSo(oHienCo[cot]);
      daCoSan.push(cu != null ? `${cot}=${cu}` : `${cot}=${JSON.stringify(oHienCo[cot])} (không đọc được thành số)`);
      continue; // ô đã có gì đó (kể cả 0, kể cả thứ không đọc được) — KHÔNG đè
    }
    patch[cot] = moi;
  }

  const oTracking = oHienCo[COT.trackingNumber];
  if (tracking != null) {
    if (oLarkTrong(oTracking)) {
      patch[COT.trackingNumber] = tracking;
    } else {
      /* Lark ĐANG giữ một mã khác: không đè (đúng luật), nhưng PHẢI nói ra. Im lặng ở đây là
       * thao tác của nhân sự bốc hơi: DB thành mã mới, Lark giữ mã cũ, rồi lượt `sync-lark`
       * kế tiếp (`patch-kien.ts`) ghi mã cũ của Lark TRỞ LẠI DB — trong khi toast đã báo
       * "Đã lưu mã mới". */
      const cu = larkText(oTracking);
      if (cu == null) {
        canhBao.push(`ô "${COT.trackingNumber}" trên Lark có dữ liệu không đọc được (${JSON.stringify(oTracking)}) — KHÔNG ghi mã ${tracking} lên Lark, vào Lark kiểm bằng mắt`);
      } else if (cu.trim().toUpperCase() !== tracking.trim().toUpperCase()) {
        canhBao.push(`Lark đang có mã vận đơn KHÁC (${cu}) — mã ${tracking} chỉ nằm trong SMS; lượt đồng bộ Lark kế tiếp sẽ ghi ${cu} trở lại, vào Lark sửa tay trước`);
      }
    }
  }

  /* Patch rỗng mà vẫn báo "đã ghi giá" là nói sai việc đã làm. Nêu ra ô nào đã có số từ
   * trước để người đọc biết đây là "không còn gì để điền", không phải "ghi xong". */
  if (Object.keys(patch).length === 0 && daCoSan.length > 0) {
    canhBao.push(`không ô nào còn trống để điền — các ô đích đã có số từ trước: ${daCoSan.join(', ')}`);
  }

  return { patch, canhBao };
}
