/**
 * THUẦN: dựng bản vá Lark cho khối ô chi phí + mã vận đơn từ `GiaUocTinh` (Task 2).
 *
 * Luật "ô trống" dùng lại nguyên của `dung-patch.ts` — `docSo` cho ô số (0 tính là ĐÃ CÓ,
 * chỉ `undefined`/`null`/không-phải-số là trống) và `larkText` cho ô chữ — để không có hai
 * định nghĩa "trống" lệch nhau trên cùng một bảng Lark.
 *
 * Khoản `null` ở `GiaUocTinh` nghĩa là "nguồn không nói gì" (xem gia-uoc-tinh.ts) — bỏ hẳn
 * khỏi patch, KHÔNG quy về 0, vì ghi 0 vào ô Đức dùng để đối chiếu sẽ biến "không biết" thành
 * "bằng không" mà không ai phát hiện được bằng mắt. `maLa` không có cột tương ứng trên Lark
 * (chỉ để người nhập thấy khoản lạ) nên không được ghi ở đây.
 */
import { larkText } from '../parse-pack-row';
import { docSo } from './dung-patch';
import { COT, COT_CHI_PHI } from './cot';
import type { GiaUocTinh } from '@/features/dong-hang/gia-uoc-tinh';

type KhoanSo = 'base' | 'fuel' | 'remote' | 'demand' | 'signature' | 'residential' | 'importHandling' | 'vat' | 'total';

/** Khoá `COT_CHI_PHI` → tên trường `GiaUocTinh`. Tên lệch vì `COT_CHI_PHI` giữ tên gốc của
 *  `shipment_charges` (`directSignature`) còn `GiaUocTinh` dùng tên ngắn gọn chung cho mọi
 *  nguồn (`signature`). `gogreen` và `elevatedRisk` không có khoản tương ứng ở `GiaUocTinh`
 *  (không hãng nào trong 3 nguồn hiện có báo hai khoản này) nên không xuất hiện ở đây — không
 *  bịa khoá để map đủ danh sách. `totalAmount` ("INS | Chi phí Tổng (đ)") CŨNG không map: cột
 *  đó là tổng THEO HOÁ ĐƠN THẬT do `dungPatch` (ghi ngược từ hãng) điền — `g.total` ở đây là
 *  ước tính trước khi có hoá đơn, ghi nhầm vào sẽ biến ước tính thành "giá đã chốt" trên bảng
 *  vận hành. */
const KHOAN_THEO_COT: Partial<Record<string, KhoanSo>> = {
  base: 'base', fuel: 'fuel', remote: 'remote', demand: 'demand',
  directSignature: 'signature', residential: 'residential', importHandling: 'importHandling',
  vat: 'vat',
};

export function patchGiaUocTinh(g: GiaUocTinh, oHienCo: Record<string, unknown>, tracking: string | null): Record<string, unknown> {
  const patch: Record<string, unknown> = {};

  for (const [khoaCot, khoaGia] of Object.entries(KHOAN_THEO_COT)) {
    const moi = g[khoaGia as KhoanSo];
    if (moi === null) continue; // không biết — không quy về 0
    const cot = COT_CHI_PHI[khoaCot];
    if (docSo(oHienCo[cot]) != null) continue; // ô đã có số (kể cả 0) — không đè
    patch[cot] = moi;
  }

  if (tracking != null && larkText(oHienCo[COT.trackingNumber]) == null) {
    patch[COT.trackingNumber] = tracking;
  }

  return patch;
}
