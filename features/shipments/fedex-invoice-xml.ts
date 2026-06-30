/**
 * Parser hoá đơn FedEx dạng XML (FedEx Billing Online "Download" export).
 * Cấu trúc: <Download> chứa nhiều <Invoice_Download> (1 block = 1 AWB), tag tiếng
 * Việt TRÙNG tên cột của file FBO XLSX → tái dùng toàn bộ phân loại phí + pipeline
 * FBO (groupFboIntoBills / importFboToDatabase). Xuất cùng FboBilledRow[] như parser
 * XLSX. Charge breakdown nằm ở cặp lặp <Nhãn_phí…>/<Số_tiền_phí…>. THUẦN.
 */
import { classifyFboCharge, parseFboAmount, fboWeightToKg, type FboBilledRow } from './fedex-fbo-parse';

const TAG = {
  awb: 'Số_vận_đơn_hàng_không',
  orderRef: 'Số_tham_chiếu_của_người_gửi_1',
  invoiceNumber: 'Số_hóa_đơn_FedEx',
  invoiceDate: 'Ngày_lập_hóa_đơn',
  dueDate: 'Ngày_đáo_hạn',
  shipDate: 'Ngày_vận_chuyển_đúng_định_dạng',
  service: 'Dịch_vụ',
  recipientCountry: 'Quốc_giavùng_lãnh_thổ_trong_địa_chỉ_của_người_nhận',
  recipientStreet1: 'Dòng_địa_chỉ_người_nhận_1',
  recipientStreet2: 'Dòng_địa_chỉ_người_nhận_2',
  recipientCity: 'Thành_phố_trong_địa_chỉ_của_người_nhận',
  recipientState: 'Tiểu_bang_trong_địa_chỉ_của_người_nhận',
  recipientPostcode: 'Mã_bưu_chính_trong_địa_chỉ_của_người_nhận',
  weight: 'Số_tiền_theo_trọng_lượng_tính_cước', // giá trị là CÂN tính cước
  weightUnit: 'Đơn_vị_trọng_lượng_thực_tế',     // K=kg, P=lb (FedEx VN: K)
  awbTotal: 'Tổng_số_tiền_trong_vận_đơn_hàng_không',
  chargeLabel: 'Nhãn_phí_trên_vận_đơn_hàng_không',
  chargeAmount: 'Số_tiền_phí_trên_vận_đơn_hàng_không',
} as const;

/** Text của tag đầu tiên trong block. '' nếu không có. */
function tag(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
  return m ? m[1].trim() : '';
}
/** Mọi giá trị của 1 tag (lặp) theo thứ tự. */
function allTags(block: string, name: string): string[] {
  const re = new RegExp(`<${name}>([^<]*)</${name}>`, 'g');
  const out: string[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.push(m[1].trim());
  return out;
}

/** Parse XML FedEx → FboBilledRow[] (cùng shape parser XLSX). Bỏ block thiếu AWB. */
export function parseFedexInvoiceXml(text: string): FboBilledRow[] {
  if (!text || !text.includes('<Invoice_Download>')) return [];
  const blocks = text.split('<Invoice_Download>').slice(1).map((b) => b.split('</Invoice_Download>')[0]);
  const out: FboBilledRow[] = [];
  for (const b of blocks) {
    const awb = tag(b, TAG.awb);
    if (!awb) continue;
    const s = (k: string): string | null => tag(b, k) || null;
    const wRaw = tag(b, TAG.weight);
    const row: FboBilledRow = {
      awb,
      orderRef: s(TAG.orderRef),
      invoiceNumber: s(TAG.invoiceNumber),
      invoiceDate: s(TAG.invoiceDate),
      dueDate: s(TAG.dueDate),
      shipDate: s(TAG.shipDate),
      service: s(TAG.service),
      recipientCountry: s(TAG.recipientCountry),
      recipientStreet1: s(TAG.recipientStreet1),
      recipientStreet2: s(TAG.recipientStreet2),
      recipientCity: s(TAG.recipientCity),
      recipientState: s(TAG.recipientState),
      recipientPostcode: s(TAG.recipientPostcode),
      weightKg: wRaw ? (fboWeightToKg(parseFboAmount(wRaw), tag(b, TAG.weightUnit) || null) || null) : null,
      base: 0, discount: 0, fuel: 0, demand: 0, remote: 0, signature: 0,
      residential: 0, addressCorrection: 0, importHandling: 0, vat: 0, duty: 0, other: 0, total: 0,
    };
    const labels = allTags(b, TAG.chargeLabel);
    const amounts = allTags(b, TAG.chargeAmount);
    labels.forEach((label, i) => { if (label) row[classifyFboCharge(label)] += parseFboAmount(amounts[i]); });
    const awbTotal = parseFboAmount(tag(b, TAG.awbTotal));
    row.total = awbTotal || (row.base + row.discount + row.fuel + row.demand + row.remote
      + row.signature + row.residential + row.addressCorrection + row.importHandling + row.vat + row.duty + row.other);
    out.push(row);
  }
  return out;
}
