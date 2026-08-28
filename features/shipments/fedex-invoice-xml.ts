/**
 * Parser hoá đơn FedEx dạng XML (FedEx Billing Online "Download" export).
 * Cấu trúc: <Download> chứa nhiều <Invoice_Download> (1 block = 1 AWB), tag tiếng
 * Việt TRÙNG tên cột của file FBO XLSX → tái dùng toàn bộ phân loại phí + pipeline
 * FBO (groupFboIntoBills / importFboToDatabase). Xuất cùng FboBilledRow[] như parser
 * XLSX. Charge breakdown nằm ở cặp lặp <Nhãn_phí…>/<Số_tiền_phí…>. THUẦN.
 */
import { classifyFboCharge, parseFboAmount, fboWeightToKg, type FboBilledRow } from './fedex-fbo-parse';

/**
 * Tên thẻ theo NGÔN NGỮ tải về. FedEx Billing Online xuất được cả bản tiếng
 * Việt lẫn tiếng Anh — cùng đuôi .XML, cùng thẻ gốc <Download>, nhìn ngoài
 * không phân biệt được. Chỉ nhận một bộ tên thì bản kia bị từ chối thẳng với
 * câu "không đúng định dạng" (CEO gặp 28/08 với hoá đơn thuế/hải quan).
 *
 * Mỗi khoá liệt kê các tên có thể gặp, thử lần lượt.
 */
const TAG = {
  awb: ['Số_vận_đơn_hàng_không', 'Air_Waybill_Number'],
  orderRef: ['Số_tham_chiếu_của_người_gửi_1', 'Shipper_Reference_1'],
  invoiceNumber: ['Số_hóa_đơn_FedEx', 'FedEx_Invoice_Number'],
  invoiceDate: ['Ngày_lập_hóa_đơn', 'Invoice_Date'],
  dueDate: ['Ngày_đáo_hạn', 'Due_Date'],
  shipDate: ['Ngày_vận_chuyển_đúng_định_dạng', 'Ship_Date_formatted'],
  service: ['Dịch_vụ', 'Service'],
  recipientCountry: ['Quốc_giavùng_lãnh_thổ_trong_địa_chỉ_của_người_nhận', 'Recipient_Address_CountryTerritory'],
  recipientStreet1: ['Dòng_địa_chỉ_người_nhận_1', 'Recipient_Address_Line_1'],
  recipientStreet2: ['Dòng_địa_chỉ_người_nhận_2', 'Recipient_Address_Line_2'],
  recipientCity: ['Thành_phố_trong_địa_chỉ_của_người_nhận', 'Recipient_Address_City'],
  recipientState: ['Tiểu_bang_trong_địa_chỉ_của_người_nhận', 'Recipient_Address_State'],
  recipientPostcode: ['Mã_bưu_chính_trong_địa_chỉ_của_người_nhận', 'Recipient_Address_Postcode'],
  weight: ['Số_tiền_theo_trọng_lượng_tính_cước', 'Rated_Weight_Amount'], // giá trị là CÂN tính cước
  // Đơn vị phải là của CHÍNH cân tính cước — không phải cân thực tế! Bug 03/08:
  // dùng Đơn_vị_trọng_lượng_thực_tế (P) áp lên cân tính cước (0.5 K) → 0.5 lb
  // = 0.227kg (#MBLVD29431 lệch cân ảo). Hai field có thể KHÁC đơn vị nhau.
  weightUnit: ['Đơn_vị_trọng_lượng_tính_cước', 'Rated_Weight_Units'],   // K=kg, P=lb
  awbTotal: ['Tổng_số_tiền_trong_vận_đơn_hàng_không', 'Air_Waybill_Total_Amount'],
  chargeLabel: ['Nhãn_phí_trên_vận_đơn_hàng_không', 'Air_Waybill_Charge_Label'],
  chargeAmount: ['Số_tiền_phí_trên_vận_đơn_hàng_không', 'Air_Waybill_Charge_Amount'],
} as const;

/** Text của thẻ đầu tiên khớp một trong các tên. '' nếu không có tên nào. */
function tag(block: string, names: readonly string[]): string {
  for (const name of names) {
    const m = block.match(new RegExp(`<${name}>([^<]*)</${name}>`));
    if (m) return m[1].trim();
  }
  return '';
}
/** Mọi giá trị của thẻ lặp, theo thứ tự; lấy theo tên đầu tiên có mặt. */
function allTags(block: string, names: readonly string[]): string[] {
  for (const name of names) {
    const re = new RegExp(`<${name}>([^<]*)</${name}>`, 'g');
    const out: string[] = []; let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) out.push(m[1].trim());
    if (out.length) return out;
  }
  return [];
}

/** Parse XML FedEx → FboBilledRow[] (cùng shape parser XLSX). Bỏ block thiếu AWB. */
export function parseFedexInvoiceXml(text: string): FboBilledRow[] {
  if (!text || !text.includes('<Invoice_Download>')) return [];
  const blocks = text.split('<Invoice_Download>').slice(1).map((b) => b.split('</Invoice_Download>')[0]);
  const out: FboBilledRow[] = [];
  for (const b of blocks) {
    const awb = tag(b, TAG.awb);
    if (!awb) continue;
    const s = (k: readonly string[]): string | null => tag(b, k) || null;
    const wRaw = tag(b, TAG.weight);
    const row: FboBilledRow = {
      awb,
      orderRef: s(TAG.orderRef),
      invoiceNumber: s(TAG.invoiceNumber),
      invoiceDate: s(TAG.invoiceDate),
      dueDate: s(TAG.dueDate),
      shipDate: s(TAG.shipDate),
      podAt: null, podName: null, // XML invoice không có cột POD (chỉ FBO xlsx).
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
