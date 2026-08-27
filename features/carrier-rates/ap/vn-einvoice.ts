/**
 * Parser hoá đơn điện tử Việt Nam (chuẩn TT78/NĐ123, thẻ tiếng Việt) — đọc
 * được cả file XML gốc lẫn text trích từ bản PDF của cùng hoá đơn.
 *
 * Dùng đầu tiên cho Aramex: bên phát hành là CÔNG TY CỔ PHẦN HỢP NHẤT QUỐC TẾ
 * (đối tác Aramex tại Việt Nam), xuất qua MISA meInvoice. Đặt tên theo CHUẨN
 * hoá đơn chứ không theo carrier vì mọi nhà vận chuyển nội địa phát hành hoá
 * đơn điện tử VN đều ra đúng cấu trúc này — thêm carrier mới chỉ cần map, không
 * phải viết lại parser.
 *
 * KHÁC BIỆT QUAN TRỌNG so với hoá đơn FedEx/DHL: đây là hoá đơn TÀI CHÍNH, mỗi
 * dòng chỉ có TỔNG TIỀN của một vận đơn. Không có cân nặng, nước đích, cũng
 * không tách cước gốc / phụ phí xăng dầu / vùng sâu vùng xa. Vì vậy đối soát
 * Aramex chỉ so được TỔNG mỗi vận đơn, không kiểm được từng thành phần như
 * FedEx. Đừng bịa số bằng cách chia tỉ lệ — thà để trống và ghi rõ.
 */

export interface VnEInvoiceLine {
  /** Số vận đơn trích từ mô tả dòng hàng. Null khi dòng không phải cước vận đơn. */
  trackingNumber: string | null;
  description: string;
  /** ĐÃ trừ chiết khấu — chuẩn TT78 ghi ThTien = số lượng × đơn giá − chiết
   *  khấu, nên không được trừ thêm lần nữa. */
  amountExVat: number;
  /** Chiết khấu của dòng (0 khi không có). Bản in PDF không tách nên là null. */
  discount: number | null;
  /** Thuế suất của dòng, ví dụ 8. Null khi không đọc được. */
  vatPercent: number | null;
  /** Null khi nguồn không có thuế từng dòng (bản PDF chỉ in tổng). */
  vatAmount: number | null;
  /** Tiền chưa thuế + thuế. Bằng amountExVat khi không biết thuế riêng. */
  total: number;
}

export interface VnEInvoice {
  /** Số hoá đơn, giữ nguyên số 0 ở đầu (00007957). */
  billNumber: string;
  /** Ký hiệu hoá đơn đầy đủ, gồm mẫu số ở đầu (1K26TMB) — bản in ghi liền như
   *  vậy, nên XML phải ghép KHMSHDon + KHHDon để hai nguồn ra cùng một chuỗi. */
  serial: string | null;
  issueDate: string;
  currency: string;
  sellerName: string | null;
  sellerTaxCode: string | null;
  buyerName: string | null;
  buyerTaxCode: string | null;
  amountExVat: number;
  vatAmount: number;
  amountInclVat: number;
  lines: VnEInvoiceLine[];
  warnings: string[];
}

const tag = (block: string, name: string): string => {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
};

const soTien = (s: string): number => {
  const n = Number((s ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** Đọc một trường trong khối <TTKhac> (cặp TTruong/DLieu). */
const truongKhac = (block: string, ten: string): string => {
  const m = block.match(new RegExp(`<TTruong>${ten}</TTruong>[\\s\\S]*?<DLieu>([\\s\\S]*?)</DLieu>`));
  return m ? m[1].trim() : '';
};

/**
 * Trích số vận đơn từ mô tả dòng hàng.
 *
 * Chỉ nhận dãy số đứng NGAY SAU chữ "vận đơn" — mô tả luôn có sẵn "tháng
 * 08/2026" phía trước, quét số bừa sẽ ra tháng thay vì vận đơn.
 */
export function trackingFromDescription(desc: string): string | null {
  if (!desc) return null;
  const m = desc.match(/vận\s*đơn\s*(?:số\s*)?[:\s]*([0-9]{6,})/i)
    ?? desc.match(/số\s*vận\s*đơn\s*[:\s]*([0-9]{6,})/i);
  return m ? m[1] : null;
}

/**
 * Kỳ hoá đơn: hoá đơn VN không có trường kỳ riêng, tháng nằm trong mô tả dòng
 * hàng ("Cước chuyển phát nhanh tháng 08/2026"). Không đọc được thì lấy tháng
 * của ngày lập — bill bắt buộc có kỳ nên không được để trống.
 */
export function periodFromLines(
  descriptions: readonly string[],
  issueDate: string,
): { periodStart: string; periodEnd: string } {
  let thang: number | null = null;
  let nam: number | null = null;
  for (const d of descriptions) {
    const m = d.match(/tháng\s*(\d{1,2})\s*\/\s*(\d{4})/i);
    if (m) { thang = Number(m[1]); nam = Number(m[2]); break; }
  }
  if (thang === null || nam === null || thang < 1 || thang > 12) {
    const d = new Date(`${issueDate}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return { periodStart: issueDate, periodEnd: issueDate };
    thang = d.getUTCMonth() + 1;
    nam = d.getUTCFullYear();
  }
  const hai = (n: number) => String(n).padStart(2, '0');
  // Ngày 0 của tháng kế = ngày cuối tháng này (tự đúng cả năm nhuận).
  const cuoi = new Date(Date.UTC(nam, thang, 0)).getUTCDate();
  return { periodStart: `${nam}-${hai(thang)}-01`, periodEnd: `${nam}-${hai(thang)}-${hai(cuoi)}` };
}

/**
 * Cảnh báo khi cộng các dòng không ra tổng ghi trên hoá đơn (bỏ qua lệch 1₫ do
 * làm tròn). Kiểm cả tiền hàng lẫn thuế: file hỏng có thể đúng tiền hàng mà sai
 * thuế, lúc đó chỉ canh tiền hàng sẽ không phát hiện.
 *
 * Chỉ canh TỔNG, không canh từng dòng: MISA bù làm tròn ở một dòng để tổng thuế
 * khớp đúng thuế suất × tổng tiền hàng (hoá đơn 1K26TMB-00007957 lệch 2,44₫ ở
 * dòng 3) — canh từng dòng sẽ báo động sai trên hoá đơn hoàn toàn hợp lệ.
 */
function kiemTong(
  lines: readonly VnEInvoiceLine[],
  amountExVat: number,
  vatAmount?: number,
): string[] {
  const out: string[] = [];
  const tongDong = lines.reduce((s, l) => s + l.amountExVat, 0);
  if (Math.abs(tongDong - amountExVat) > 1) {
    out.push(`Tổng các dòng (${tongDong.toLocaleString('vi-VN')}₫) lệch so với tổng ghi trên hoá đơn (${amountExVat.toLocaleString('vi-VN')}₫) — kiểm tra lại file.`);
  }
  // Chỉ so khi MỌI dòng đều có thuế; bản in PDF không tách thuế từng dòng.
  if (vatAmount !== undefined && lines.length > 0 && lines.every((l) => l.vatAmount !== null)) {
    const tongThue = lines.reduce((s, l) => s + (l.vatAmount ?? 0), 0);
    if (Math.abs(tongThue - vatAmount) > 1) {
      out.push(`Cộng thuế các dòng (${tongThue.toLocaleString('vi-VN')}₫) lệch so với thuế ghi trên hoá đơn (${vatAmount.toLocaleString('vi-VN')}₫) — kiểm tra lại file.`);
    }
  }
  return out;
}

export function parseVnEInvoiceXml(text: string): VnEInvoice | null {
  if (!text || !/<HDon\b/.test(text) || !/<DLHDon\b/.test(text)) return null;

  const chung = text.match(/<TTChung>([\s\S]*?)<\/TTChung>/)?.[1] ?? '';
  const billNumber = tag(chung, 'SHDon');
  const issueDate = tag(chung, 'NLap');
  if (!billNumber || !issueDate) return null;

  const nban = text.match(/<NBan>([\s\S]*?)<\/NBan>/)?.[1] ?? '';
  const nmua = text.match(/<NMua>([\s\S]*?)<\/NMua>/)?.[1] ?? '';

  const lines: VnEInvoiceLine[] = [];
  for (const raw of text.split('<HHDVu>').slice(1)) {
    const block = raw.split('</HHDVu>')[0];
    const description = tag(block, 'THHDVu');
    const amountExVat = soTien(tag(block, 'ThTien'));
    const vatRaw = truongKhac(block, 'VATAmount');
    const vatAmount = vatRaw ? soTien(vatRaw) : null;
    const tsuat = tag(block, 'TSuat').match(/([\d.]+)\s*%/);
    lines.push({
      trackingNumber: trackingFromDescription(description),
      description,
      amountExVat,
      discount: soTien(tag(block, 'STCKhau')),
      vatPercent: tsuat ? Number(tsuat[1]) : null,
      vatAmount,
      total: amountExVat + (vatAmount ?? 0),
    });
  }

  const toan = text.match(/<TToan>([\s\S]*?)<\/TToan>/)?.[1] ?? '';
  const amountExVat = soTien(tag(toan, 'TgTCThue'));
  const vatAmount = soTien(tag(toan, 'TgTThue'));
  const amountInclVat = soTien(tag(toan, 'TgTTTBSo'));

  const warnings = kiemTong(lines, amountExVat, vatAmount);
  const thieuTracking = lines.filter((l) => !l.trackingNumber).length;
  if (thieuTracking > 0) {
    warnings.push(`${thieuTracking}/${lines.length} dòng không đọc được số vận đơn — sẽ nhập nhưng không khớp được đơn.`);
  }

  return {
    billNumber,
    serial: (tag(chung, 'KHMSHDon') + tag(chung, 'KHHDon')) || null,
    issueDate,
    currency: tag(chung, 'DVTTe') || 'VND',
    sellerName: tag(nban, 'Ten') || null,
    sellerTaxCode: tag(nban, 'MST') || null,
    buyerName: tag(nmua, 'Ten') || null,
    buyerTaxCode: tag(nmua, 'MST') || null,
    amountExVat,
    vatAmount,
    amountInclVat,
    lines,
    warnings,
  };
}

/** '605.656' → 605656. Hoá đơn VN dùng dấu chấm ngăn nghìn. */
const soTienVn = (s: string): number => {
  const n = Number((s ?? '').replace(/[.\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * Mã số thuế trong bản in được giãn từng chữ số ("0 3 0 5 1 4 1 8 9 4") → gom
 * lại. Cắt về đúng độ dài hợp lệ (10 số, hoặc 13 số khi có mã đơn vị phụ
 * thuộc): bản in đặt số thứ tự dòng ngay dưới ô mã số thuế nên nếu không cắt,
 * chữ số đầu của dòng sau sẽ bị dính vào (bắt được khi dựng parser).
 */
const gomMst = (s: string): string => {
  const so = s.replace(/[^0-9]/g, '');
  if (so.length === 10 || so.length === 13) return so;
  return so.length > 13 ? so.slice(0, 13) : so.slice(0, 10);
};

export function parseVnEInvoicePdfText(text: string): VnEInvoice | null {
  if (!text || !/HÓA ĐƠN GIÁ TRỊ GIA TĂNG/i.test(text)) return null;

  const billNumber = text.match(/Số\s*\(No\.?\):?\s*([0-9]+)/i)?.[1] ?? '';
  const ngay = text.match(/Ngày\s*\(Date\)\s*(\d{1,2})\s*tháng\s*\(month\)\s*(\d{1,2})\s*năm\s*\(year\)\s*(\d{4})/i);
  if (!billNumber || !ngay) return null;
  const hai = (n: string) => n.padStart(2, '0');
  const issueDate = `${ngay[3]}-${hai(ngay[2])}-${hai(ngay[1])}`;

  // Hai mã số thuế xuất hiện theo thứ tự: người bán ở đầu trang, người mua
  // trong khối thông tin người mua.
  // [^\S\n] = khoảng trắng NHƯNG không phải xuống dòng — giữ khớp trong một dòng.
  const mst = [...text.matchAll(/Mã số thuế\s*\(Tax code\):?[^\S\n]*([0-9][0-9 \t]{8,})/gi)].map((m) => gomMst(m[1]));

  const lines: VnEInvoiceLine[] = [];
  for (const raw of text.split('\n')) {
    const tracking = trackingFromDescription(raw);
    if (!tracking) continue;
    // Cột cuối cùng là Thành tiền; đơn giá đứng ngay trước nên lấy số cuối dòng.
    const so = [...raw.matchAll(/([0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+)/g)].map((m) => m[1]);
    const cuoi = so[so.length - 1] ?? '0';
    lines.push({
      trackingNumber: tracking,
      description: raw.trim().replace(/\s{2,}/g, ' '),
      amountExVat: soTienVn(cuoi),
      // Bản in KHÔNG tách thuế/chiết khấu từng dòng — chỉ có tổng ở cuối.
      discount: null,
      vatPercent: null,
      vatAmount: null,
      total: soTienVn(cuoi),
    });
  }

  const amountExVat = soTienVn(text.match(/Total amount excl\. VAT\):?\s*([0-9.,]+)/i)?.[1] ?? '');
  const vatAmount = soTienVn(text.match(/VAT amount\):?\s*([0-9.,]+)/i)?.[1] ?? '');
  const amountInclVat = soTienVn(text.match(/Tổng tiền thanh toán\s*\(Total amount\):?\s*([0-9.,]+)/i)?.[1] ?? '');

  const warnings = kiemTong(lines, amountExVat);
  warnings.push('Bản PDF không in thuế từng dòng — chỉ có tổng. Tải kèm file XML nếu cần thuế theo từng vận đơn.');

  const ten = (re: RegExp) => text.match(re)?.[1]?.trim() ?? null;

  return {
    billNumber,
    serial: text.match(/Ký hiệu\s*\(Serial\):?\s*(\S+)/i)?.[1] ?? null,
    issueDate,
    currency: 'VND',
    sellerName: text.split('\n').map((l) => l.trim()).find((l) => /^CÔNG TY/i.test(l)) ?? null,
    sellerTaxCode: mst[0] ?? null,
    buyerName: ten(/Tên đơn vị \(Company's name\):\s*(.+)/i),
    buyerTaxCode: mst[1] ?? null,
    amountExVat,
    vatAmount,
    amountInclVat,
    lines,
    warnings,
  };
}
