/**
 * Bộ THEO DÕI tài liệu Surge Emergency Fee của UPS.
 * ================================================
 *
 * Tài liệu (CEO gửi 12/10/2026):
 *   https://assets.ups.com/adobe/assets/urn:aaid:aem:2840054d-e7bd-47d5-925d-a940bcd4efe5/original/as/surge-fee-us-en.pdf
 *
 * VÌ SAO CHỈ "THEO DÕI" MÀ KHÔNG TỰ GHI GIÁ — ba lý do, không phải sự dè dặt:
 *
 *  1. Tài liệu này là bản ORIGIN = UNITED STATES. Hàng mình đi từ VIỆT NAM. Dòng duy nhất
 *     chạm tới mình là "Australia, New Zealand, India, or Rest of Asia → United States"
 *     ($0,77/lb, hiệu lực 27/09/2026) — và "Rest of Asia" có Việt Nam trong danh sách vùng
 *     UPS in ở cuối tài liệu. Các tuyến VN → Úc · Bồ Đào Nha · Thái… KHÔNG có trong tờ này.
 *
 *  2. Tài liệu ghi USD/lb, UPS Việt Nam thu VND/kg, và tỉ giá quy đổi KHÔNG suy ra được:
 *     hoá đơn tháng 9 cho 39.950đ/kg = 18.121đ/lb cho dòng $0,77 (ra tỉ giá 23.534), còn
 *     mức cũ 11.750đ/kg = 5.330đ/lb cho dòng $0,23 (ra 23.174). Hai tỉ giá khác nhau → UPS
 *     VN công bố thẳng số VND chứ không nhân tỉ giá. Tự quy đổi là bịa số.
 *
 *  3. Giá VND đúng thì HOÁ ĐƠN nói, và nói chính xác: mức 11.750đ/kg khớp 29/29 lô, mức
 *     39.950đ/kg khớp 8/8 lô (xem `scripts/sua-phu-phi-ups.ts`).
 *
 * NÊN việc của module này là: mỗi tuần tải tờ PDF, lấy DẤU VẾT của nó, và khi dấu vết ĐỔI
 * (UPS sửa mức hoặc sửa NGÀY HIỆU LỰC — CEO lưu ý đúng chỗ này) thì BÁO ĐỘNG để người đi
 * đọc lại và chốt mức VND mới. Không im lặng ghi gì vào bảng giá.
 *
 * Việc nhận dạng cấu trúc bảng: tờ PDF trải ra text bị trộn cột (origin/destination/service
 * nằm lẫn nhau nhiều dòng), nên bộ đọc này KHÔNG cố hiểu cả bảng. Nó bắt thứ chắc chắn đọc
 * được — mọi khoản `$X per lb|package` kèm `Effective <ngày>` và ngày "update as of" ở đầu
 * tờ — rồi chỉ ra dòng nào có chữ "Rest of Asia"/"Vietnam" để người đọc nhìn đúng chỗ. Cố
 * dựng lại bảng từ text trộn cột là chỗ dễ sai mà không ai kiểm được.
 *
 * THUẦN — không I/O (trừ `tanSurgeUps` ở cuối, tách riêng để test được phần đọc).
 */

/** Trang hub của UPS VN, nơi có link tài liệu phụ phí. Tờ surge nằm ở bản US (xem đầu file). */
export const UPS_SURGE_PAGE_URL =
  'https://www.ups.com/vn/en/support/shipping-support/shipping-costs-rates';

/** Asset AEM của tờ PDF. UPS publish lại là urn đổi → `tanSurgeUps` ném lỗi rõ ràng,
 *  giống hệt bộ lấy fuel (xem `fuel-fetcher/ups.ts`). */
export const UPS_SURGE_PDF_URL =
  'https://assets.ups.com/adobe/assets/urn:aaid:aem:2840054d-e7bd-47d5-925d-a940bcd4efe5/original/as/surge-fee-us-en.pdf';

export interface KhoanSurge {
  /** Số tiền UPS in ra, theo USD. */
  tien: number;
  donVi: 'lb' | 'package';
  /** Ngày hiệu lực ISO đọc được từ cụm "Effective September 27, 2026". null = dòng trong
   *  bảng theo CỬA SỔ ngày (cột "5/31/26 through 9/26/26"), không có chữ Effective. */
  hieuLucTu: string | null;
  /** Đoạn text quanh khoản đó — để người đọc biết nó là tuyến nào mà không phải mở PDF.
   *  Lấy CẢ HAI PHÍA: tên tuyến bị trộn cột nên có thể nằm sau số tiền ("Australia, New
   *  Zealand," ở trước mà "India, or Rest of Asia" lại rơi xuống sau phần tên dịch vụ). */
  boiCanh: string;
}

export interface SurgeUps {
  /** Ngày ở câu "Surge Emergency Fee update as of September 18, 2026" (ISO). */
  capNhatNgay: string | null;
  khoan: KhoanSurge[];
  /**
   * Những khoản có chữ "Rest of Asia"/"Vietnam" trong bối cảnh — GỢI Ý chỗ cần đọc, không
   * phải kết luận. Text PDF trộn cột: dòng tên tuyến bị cắt làm hai, nên phần đuôi ("India,
   * or Rest of Asia") nằm giữa số tiền của hàng NÀY và số tiền của hàng SAU — hàng sau vì
   * thế cũng bị gắn nhãn. Chấp nhận lọt thêm một hàng kề: việc của nó là trỏ người đọc vào
   * đúng khu vực, còn thứ quyết định có báo động hay không là `dauVet`.
   */
  khoanLienQuanVn: KhoanSurge[];
  /** Dấu vết của cả tờ. Đổi dấu vết = tờ đã khác → đi đọc lại. */
  dauVet: string;
}

const THANG: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

/** "September 27, 2026" → "2026-09-27". Không đọc được → null. */
export function ngayTiengAnh(raw: string): string | null {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(raw.trim());
  const thang = m ? THANG[m[1].toLowerCase()] : undefined;
  if (!m || !thang) return null;
  return `${m[3]}-${thang}-${m[2].padStart(2, '0')}`;
}

/** Hash 32-bit FNV-1a → 8 ký tự hex. Đủ để BẮT THAY ĐỔI (không dùng cho bảo mật). */
function dauVan(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Đọc text đã trích từ PDF surge của UPS.
 *
 * Không thấy khoản nào → null (gọi được coi là "tờ sai định dạng", đừng tưởng là "UPS bỏ
 * phí surge" — hai việc khác nhau hoàn toàn).
 */
export function docSurgeUpsPdf(text: string): SurgeUps | null {
  if (!text) return null;
  const phang = text.replace(/\s+/g, ' ').trim();
  if (!/surge emergency fee/i.test(phang)) return null;

  const capNhat = /update as of ([A-Za-z]+ \d{1,2}, \d{4})/i.exec(phang);
  const capNhatNgay = capNhat ? ngayTiengAnh(capNhat[1]) : null;

  /* Bối cảnh của một khoản = đoạn text NẰM GIỮA khoản liền trước và khoản liền sau. Đó là
   * ranh giới tự nhiên của một hàng trong bảng này, và nó quan trọng: tên tuyến bị cắt làm
   * hai dòng nên có thể nằm SAU số tiền ("Australia, New Zealand," ở trước mà "India, or
   * Rest of Asia" rơi xuống sau tên dịch vụ).
   *
   * Không dùng cửa sổ N ký tự cố định: phần cuối tờ có BẢNG GIẢI THÍCH VÙNG liệt kê cả
   * "Rest of Asia … Vietnam", và một cửa sổ rộng sẽ quét tới đó rồi gán nhãn "chạm tuyến VN"
   * cho những dòng không liên quan (bắt được khi test trên bản trích gọn). Vì thế cũng CẮT
   * bối cảnh tại tiêu đề bảng vùng. */
  const BANG_VUNG = /Countries Included in Each Region/i;
  const vtBangVung = BANG_VUNG.exec(phang)?.index ?? phang.length;

  const re = /\$\s?([\d,]+(?:\.\d+)?)\s*(?:USD\s*)?per\s+(lb|package)/gi;
  const batDuoc = [...phang.matchAll(re)];
  const khoan: KhoanSurge[] = batDuoc.flatMap((m, i) => {
    const tien = Number(m[1].replace(/,/g, ''));
    if (!Number.isFinite(tien)) return [];
    const dau = m.index ?? 0;
    const cuoi = dau + m[0].length;
    const truocDau = i === 0 ? Math.max(0, dau - 300) : ((batDuoc[i - 1].index ?? 0) + batDuoc[i - 1][0].length);
    const sauCuoi = Math.min(
      i === batDuoc.length - 1 ? cuoi + 420 : (batDuoc[i + 1].index ?? phang.length),
      vtBangVung > cuoi ? vtBangVung : phang.length,
    );
    const truoc = phang.slice(truocDau, dau);
    const sau = phang.slice(cuoi, Math.max(cuoi, sauCuoi));
    const hl = /Effective ([A-Za-z]+ \d{1,2}, \d{4})/i.exec(sau);
    return [{
      tien,
      donVi: m[2].toLowerCase() as 'lb' | 'package',
      hieuLucTu: hl ? ngayTiengAnh(hl[1]) : null,
      boiCanh: `${truoc.slice(-250)} \u27E6$${m[1]}/${m[2]}\u27E7 ${sau.slice(0, 250)}`.trim(),
    }];
  });
  if (khoan.length === 0) return null;

  const khoanLienQuanVn = khoan.filter((k) => /rest of asia|vietnam/i.test(k.boiCanh));

  /* DẤU VẾT phải bắt được MỌI thay đổi của tờ, kể cả những khoản mà bộ đọc ở trên không
   * dựng thành dòng được: ba hàng "Other Charges" (Additional Handling / Large Package /
   * Over Maximum) in theo CỬA SỔ NGÀY trên 4 cột, text trích ra trộn hết "per package" sang
   * dòng dưới nên không ghép lại được thành cặp (tiền, đơn vị). Nếu dấu vết chỉ gồm các dòng
   * dựng được thì UPS sửa mấy cột đó mà mình không hay.
   *
   * Nên dấu vết lấy BA thứ thô, không cần hiểu bảng: mọi số tiền $, mọi ngày "Effective",
   * và mọi ngày dạng m/d/yy (các cột cửa sổ "5/31/26 … through … 9/26/26" — chữ "through"
   * bị gom hết sang một dòng khác nên không ghép cặp được, lấy từng ngày là xong). Sắp xếp
   * để không phụ thuộc thứ tự dòng. KHÔNG lấy bối cảnh: text trộn cột đổi theo lề trang
   * chứ không theo giá. */
  const moiTien = [...phang.matchAll(/\$\s?([\d,]+(?:\.\d+)?)/g)].map((x) => x[1].replace(/,/g, ''));
  const moiNgay = [...phang.matchAll(/Effective ([A-Za-z]+ \d{1,2}, \d{4})/gi)].map((x) => ngayTiengAnh(x[1]) ?? x[1]);
  const moiCuaSo = [...phang.matchAll(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/g)].map((x) => x[1]);
  const xuong = [
    `cn=${capNhatNgay ?? '?'}`,
    `tien=${[...moiTien].sort().join(',')}`,
    `hl=${[...moiNgay].sort().join(',')}`,
    `cs=${[...moiCuaSo].sort().join(',')}`,
  ].join('|');
  return {
    capNhatNgay, khoan, khoanLienQuanVn,
    dauVet: `ups-surge@${capNhatNgay ?? '?'}|${moiTien.length}t/${moiNgay.length}h/${moiCuaSo.length}c|${dauVan(xuong)}`,
  };
}

const HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SMS-surge-cron',
  Accept: 'application/pdf,*/*;q=0.8',
};

/** Tải tờ PDF. Trả BYTES — người gọi lo trích text (tránh kéo pdf-parse vào module thuần). */
export async function taiSurgeUpsPdf(url = UPS_SURGE_PDF_URL): Promise<Uint8Array> {
  const res = await fetch(url, { headers: HEADERS, cache: 'no-store' });
  if (!res.ok) {
    throw new Error(
      `taiSurgeUpsPdf: assets.ups.com trả ${res.status} — rất có thể UPS đã publish lại tài liệu `
      + `dưới urn mới. Mở ${UPS_SURGE_PAGE_URL} bằng trình duyệt thật, lấy link PDF mới rồi `
      + 'cập nhật UPS_SURGE_PDF_URL.',
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}
