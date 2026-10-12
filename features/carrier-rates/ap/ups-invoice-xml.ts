/**
 * Parser hoá đơn UPS dạng XML (UPS Billing Data — `UPS_EBR_BILL`, schema EBR/Billing/v1).
 *
 * Xuất ra `FboBilledRow[]` — ĐÚNG hình của parser FedEx — để dùng lại nguyên pipeline
 * `groupFboIntoBills` → `importFboToDatabase` (tạo bill + dòng bill, nối shipment, nối duty
 * đơn ship hộ). Hình này có đủ 14 cột phụ phí nên không mất khoản nào; thêm cột thứ 15
 * `internationalProcessing` riêng cho UPS (xem `db/migrations/0203`).
 *
 * CẤU TRÚC (đo trên hoá đơn thật 100000813108, 06/10/2026 — 69.119.131đ):
 *   Invoice
 *     ├─ InvoiceNumber / InvoiceDateCCYYMMDD / InvoiceDueDateCCYYMMDD / InvoiceAmount
 *     ├─ TaxVarianceAmount        ← chênh làm tròn thuế, CHỈ có ở cấp hoá đơn
 *     └─ TransactionDetails ×N    ← N nhóm: SHP = cước lô, ADJ = điều chỉnh hoá đơn CŨ
 *          └─ Shipment ×M         ← LeadShipmentNumber, ngày đi, mã đơn, địa chỉ
 *               └─ Package ×P     ← TrackingNumber, cân, rồi Charge → ChargeInformation
 *
 * BA CÁI BẪY, cả ba đều đã làm sai ít nhất một lượt khi đọc file này:
 *
 * 1. Tiền nằm ở `ChargeInformation`, KHÔNG ở `Charge`. Một `<Charge>` chứa NHIỀU
 *    `<ChargeInformation>` (vd ACC gom Signature + International Processing). Đọc ở cấp
 *    `Charge` thì rơi 66/279 khoản.
 * 2. Một vận đơn xuất hiện NHIỀU `Package`: kiện thật (có phí) + kiện `INF` 0đ chỉ để
 *    nhắc tên dịch vụ. Và nếu lô bị điều chỉnh thì vận đơn còn xuất hiện lại ở nhóm ADJ.
 *    Cộng cân qua các kiện ấy là nhân cân lên — lấy MAX như `aggregateBilledLines` làm.
 * 3. Phân loại theo `ClassificationCode` TRƯỚC, mô tả sau — nhưng FRT có ngoại lệ: UPS
 *    đặt "Address Correction WW Expedited" dưới class FRT, nên nhìn mô tả mới ra phí sửa
 *    địa chỉ chứ không phải cước.
 *
 * QUY ƯỚC GIÁ (giống FedEx): `base` là cước NIÊM YẾT, `discount` là số ÂM.
 * UPS ghi mỗi khoản hai số — `NetAmount` (thực trả) và `IncentiveAmount` (phần được trừ):
 *   base     = Σ (Net + Incentive) của FRT   → cước niêm yết
 *   discount = − Σ Incentive của FRT          → chiết khấu cước
 *   fuel     = Σ Net của FSC                  → nhiên liệu THỰC TRẢ
 * Cột `fuel` cố ý mang số THỰC TRẢ (không niêm yết) để so được với phần nhiên liệu mình
 * thu brand; đổi lại `discount` chỉ là chiết khấu CƯỚC, không gồm 62.935.350đ chiết khấu
 * mà UPS trừ trên chính dòng nhiên liệu. Σ các cột vẫn đúng bằng tiền hoá đơn — đã kiểm.
 *
 * LƯU Ý gốc tính nhiên liệu: fuel/cước-niêm-yết của hoá đơn này KHÔNG ra một mức công bố
 * nào (10,8%–16,3%, lệch nhau trong cùng ngày), mà fuel/cước-thực-trả càng không (47%–80%).
 * Tức gốc tính nhiên liệu của UPS chưa suy ra được từ file; `gocFuelTrenBill` là công thức
 * của FedEx, nên cột %fuel trên bảng đối soát sẽ TỰ ĐỘNG để trống cho đơn UPS (chốt lưới
 * 0,25% của `phanTramFuelDangTin`). Đó là ĐÚNG — chưa biết thì không hiện số. Muốn thu
 * nhiên liệu UPS theo %bill thì phải hỏi UPS gốc tính, chưa làm trong lượt này.
 *
 * THUẦN — không I/O.
 */
import { fboWeightToKg, type FboBilledRow } from '@/features/shipments/fedex-fbo-parse';

/** Khoản phí UPS ở mức chi tiết nhất mà hoá đơn có (`ChargeInformation`). */
export interface UpsKhoanPhi {
  /** `ClassificationCode` của `<Charge>` bọc ngoài: FRT cước · FSC nhiên liệu · ACC phụ phí
   *  · TAX thuế · INF dòng thông tin 0đ. */
  lop: string;
  /** `DescriptionCode` — mã khoản của UPS (DCS, FIP, RES, PFR…). Có thể rỗng. */
  ma: string;
  /** `DescriptionOfCharges` — tên UPS in trên hoá đơn. */
  ten: string;
  /** `NetAmount` — số THỰC TRẢ. */
  net: number;
  /** `IncentiveAmount` — phần UPS trừ so với giá niêm yết. */
  chietKhau: number;
}

/** Cột của `FboBilledRow` mà một khoản phí UPS rơi vào. */
export type ThungUps =
  | 'base' | 'discount' | 'fuel' | 'demand' | 'remote' | 'signature' | 'residential'
  | 'addressCorrection' | 'importHandling' | 'duty' | 'additionalHandling'
  | 'internationalProcessing' | 'vat' | 'other'
  /** Dòng thông tin 0đ — không phải phí, bỏ hẳn. */
  | 'bo';

/**
 * Mã phí ACC của UPS → cột. Chốt từng mã bằng hoá đơn thật, không đoán theo tên:
 *  - DCS Signature Required            → `signature`
 *  - RES Residential                   → `residential`
 *  - PFR/PFC Surge Emergency Fee       → `demand` (phụ phí cao điểm, đúng họ với Demand
 *                                        Surcharge của FedEx; Resi và Com là cùng khoản
 *                                        khác mức, nên cùng cột)
 *  - ESD Extended Area Surcharge-Dest  → `remote` (vùng xa điểm đến)
 *  - FIP International Processing Fee  → cột RIÊNG, giữ tên UPS (CEO 12/10/2026)
 *  - F/D D&T Forwarding Surcharge      → `importHandling`
 *
 * Vì sao F/D là `importHandling` chứ không `duty` (CEO chốt lại 12/10/2026 sau khi xem bằng
 * chứng): đây là PHÍ DỊCH VỤ của UPS khi họ ứng và làm thủ tục thuế, không phải chính khoản
 * thuế. Hai dấu hiệu cùng chỉ một hướng:
 *   1. Hoá đơn ghi `TaxIndicator = 1`, tức UPS CÓ tính 8% VAT lên khoản này. Đúng phép thử mà
 *      `classifyFboCharge` dùng cho FedEx: có VAT = phí dịch vụ → `importHandling`; không VAT
 *      = pass-through thuần → `duty`.
 *   2. Để ở `duty` thì khoản này chảy vào `actual_duty_vnd` của đơn ship hộ qua
 *      `getDutyLinesByTracking`, tức THU LẠI CỦA BRAND như một khoản thuế ứng hộ — trong khi
 *      nó là phí của hãng. Và `consolidateFboShipping` bỏ nguyên dòng có `duty > 0` khỏi
 *      đối soát cước, nên lô ấy mất luôn chi phí thật.
 */
const ACC_THEO_MA: Record<string, ThungUps> = {
  DCS: 'signature',
  RES: 'residential',
  PFR: 'demand',
  PFC: 'demand',
  ESD: 'remote',
  FIP: 'internationalProcessing',
  'F/D': 'importHandling',
};

/** Một khoản phí UPS rơi vào cột nào. THUẦN. */
export function thungChoKhoanUps(k: Pick<UpsKhoanPhi, 'lop' | 'ma' | 'ten'>): ThungUps {
  if (k.lop === 'INF') return 'bo';
  if (k.lop === 'TAX') return 'vat';
  if (k.lop === 'FSC') return 'fuel';
  if (k.lop === 'ACC') return ACC_THEO_MA[k.ma] ?? 'other';
  if (k.lop === 'FRT') {
    // Ngoại lệ đã gặp thật: phí sửa địa chỉ nằm dưới class CƯỚC.
    if (/address correction/i.test(k.ten)) return 'addressCorrection';
    if (/additional handling/i.test(k.ten)) return 'additionalHandling';
    return 'base';
  }
  return 'other';
}

export interface UpsHoaDon {
  billNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  /** `InvoiceAmount` — số PHẢI TRẢ UPS. Đây mới là số đi vào `carrier_bills.amount`, không
   *  phải Σ dòng: chênh đúng bằng `TaxVarianceAmount` (xem dưới). */
  amount: number;
  /** Chênh làm tròn thuế ở cấp hoá đơn (7.746đ ở hoá đơn tháng 9) — không thuộc vận đơn nào
   *  nên không nhét vào dòng nào được. Σ dòng + khoản này = `amount`. */
  taxVariance: number;
  periodStart: string | null;
  periodEnd: string | null;
  rows: FboBilledRow[];
  /** Mã phí UPS chưa biết xếp đâu (rơi vào `other`) — nêu ra để người nhập thấy ngay, thay
   *  vì để nó lặng lẽ nằm trong "phụ phí chưa phân loại". */
  maLa: string[];
  /** Số dòng `ChargeInformation` đã đọc (gồm cả dòng INF bị bỏ) — để đối chiếu với file. */
  soKhoan: number;
}

/** '20260903' → '2026-09-03'. Khác định dạng → null. */
function ngayUps(s: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(s.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function o(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].trim() : '';
}
function so(block: string, tag: string): number {
  const n = Number(o(block, tag).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}
/** Ruột của từng khối `<tag>…</tag>`. Các thẻ dùng ở đây không lồng chính nó. */
function khoi(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const out: string[] = []; let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) out.push(m[1]);
  return out;
}

const SO_0 = {
  base: 0, discount: 0, fuel: 0, demand: 0, remote: 0, signature: 0, residential: 0,
  addressCorrection: 0, importHandling: 0, duty: 0, additionalHandling: 0,
  internationalProcessing: 0, vat: 0, other: 0,
} as const;

/** File này có phải hoá đơn UPS Billing XML không. */
export function laHoaDonUpsXml(text: string): boolean {
  return !!text && /<UPS_EBR_BILL\b/.test(text);
}

/**
 * Parse hoá đơn UPS XML → một hoá đơn với N dòng, MỖI VẬN ĐƠN MỘT DÒNG.
 *
 * Gộp theo vận đơn (không theo `Shipment`) vì cùng một vận đơn có thể nằm ở nhiều nhóm
 * `TransactionDetails`: cước ở nhóm SHP, rồi điều chỉnh ở nhóm ADJ. Hai thứ đó cùng nằm
 * trên MỘT hoá đơn này nên thuộc cùng một dòng — đối soát mới thấy đúng tiền kỳ này.
 *
 * Không đúng định dạng → null (để caller báo đúng loại file, xem `nhanDangXmlHoaDon`).
 */
export function parseUpsInvoiceXml(text: string): UpsHoaDon | null {
  if (!laHoaDonUpsXml(text)) return null;
  const invBlocks = khoi(text, 'Invoice');
  if (invBlocks.length === 0) return null;
  const inv = invBlocks[0];
  const billNumber = o(inv, 'InvoiceNumber');
  if (!billNumber) return null;

  const theoVanDon = new Map<string, FboBilledRow>();
  const maLa = new Set<string>();
  let soKhoan = 0;

  for (const td of khoi(inv, 'TransactionDetails')) {
    for (const sh of khoi(td, 'Shipment')) {
      const shipDate = ngayUps(o(sh, 'TransactionDateCCYYMMDD'));
      const orderRef = o(sh, 'ReferenceNumber') || null;
      const nhan = sh.match(/<ConsigneeAddress>([\s\S]*?)<\/ConsigneeAddress>/)?.[1] ?? '';
      for (const pk of khoi(sh, 'Package')) {
        const tracking = o(pk, 'TrackingNumber');
        if (!tracking) continue;
        // Cân TÍNH CƯỚC của UPS (`BilledWeight`), không phải cân cân được
        // (`ActualWeight`) — hai thẻ nằm cạnh nhau và có thể khác nhau (1.0 vs 1.5).
        const khoiCan = pk.match(/<BilledWeight>([\s\S]*?)<\/BilledWeight>/)?.[1] ?? '';
        const canKg = khoiCan
          ? fboWeightToKg(so(khoiCan, 'Weight'), o(khoiCan, 'UnitOfMeasure') || null)
          : 0;

        let row = theoVanDon.get(tracking);
        if (!row) {
          row = {
            awb: tracking,
            orderRef,
            invoiceNumber: billNumber,
            invoiceDate: ngayUps(o(inv, 'InvoiceDateCCYYMMDD')),
            dueDate: ngayUps(o(inv, 'InvoiceDueDateCCYYMMDD')),
            shipDate,
            service: null,
            podAt: null, podName: null, // hoá đơn UPS không mang bằng chứng giao hàng
            recipientCountry: o(nhan, 'CountryorTerritoryCode') || null,
            recipientStreet1: o(nhan, 'StreetAddress') || null,
            recipientStreet2: null,
            recipientCity: o(nhan, 'CityName') || null,
            recipientState: o(nhan, 'StateCode') || null,
            recipientPostcode: o(nhan, 'PostalCode') || null,
            weightKg: null,
            ...SO_0,
            total: 0,
          };
          theoVanDon.set(tracking, row);
        }
        row.orderRef = row.orderRef ?? orderRef;
        /* Nhóm điều chỉnh (ADJ) đứng TRƯỚC nhóm cước trong file và có thể KHÔNG mang địa
         * chỉ (2/40 lô của tờ tháng 9). Dòng được tạo ở lượt đầu gặp vận đơn, nên phải
         * điền bù khi lượt sau có — không thì nước đến của chính lô đó bị null. */
        if (!row.recipientCountry) row.recipientCountry = o(nhan, 'CountryorTerritoryCode') || null;
        if (!row.recipientStreet1) row.recipientStreet1 = o(nhan, 'StreetAddress') || null;
        if (!row.recipientCity) row.recipientCity = o(nhan, 'CityName') || null;
        if (!row.recipientState) row.recipientState = o(nhan, 'StateCode') || null;
        if (!row.recipientPostcode) row.recipientPostcode = o(nhan, 'PostalCode') || null;
        // Ngày đi: lấy ngày SỚM NHẤT — dòng điều chỉnh mang ngày của lô gốc.
        if (shipDate && (!row.shipDate || shipDate < row.shipDate)) row.shipDate = shipDate;
        // Cân: MAX, không cộng (bẫy #2 ở đầu file).
        if (canKg > 0) row.weightKg = Math.max(row.weightKg ?? 0, canKg);

        for (const ch of khoi(pk, 'Charge')) {
          const lop = o(ch, 'ClassificationCode');
          for (const ci of khoi(ch, 'ChargeInformation')) {
            soKhoan += 1;
            const k: UpsKhoanPhi = {
              lop,
              ma: o(ci, 'DescriptionCode'),
              ten: o(ci, 'DescriptionOfCharges'),
              net: so(ci, 'NetAmount'),
              chietKhau: so(ci, 'IncentiveAmount'),
            };
            const thung = thungChoKhoanUps(k);
            if (thung === 'bo') continue;
            if (thung === 'other' && (k.ma || k.ten)) maLa.add(`${k.lop}/${k.ma || k.ten}`);
            /* Tên dịch vụ: chỉ lấy từ dòng CƯỚC thật ("WW Expedited", "WW Express Saver").
             * Bỏ dòng điều chỉnh — "WW Expedited Adjustment" là tên của khoản điều chỉnh,
             * không phải tên dịch vụ, và nó đứng trước dòng cước nên "ai đến trước thắng"
             * cho ra sai tên ở 2/37 dòng. */
            if (!row.service && thung === 'base' && k.ten && !/adjustment/i.test(k.ten)) {
              row.service = k.ten;
            }
            if (thung === 'base') {
              // Niêm yết = thực trả + chiết khấu; chiết khấu ghi số âm (quy ước FedEx).
              row.base += k.net + k.chietKhau;
              row.discount -= k.chietKhau;
            } else {
              row[thung] += k.net;
            }
            row.total += k.net;
          }
        }
      }
    }
  }

  const rows = [...theoVanDon.values()];
  const ngay = rows.map((r) => r.shipDate).filter((d): d is string => !!d).sort();
  return {
    billNumber,
    issueDate: ngayUps(o(inv, 'InvoiceDateCCYYMMDD')),
    dueDate: ngayUps(o(inv, 'InvoiceDueDateCCYYMMDD')),
    currency: o(inv, 'InvoiceCurrencyCode') || 'VND',
    amount: so(inv, 'InvoiceAmount'),
    taxVariance: so(inv, 'TaxVarianceAmount'),
    periodStart: ngay[0] ?? null,
    periodEnd: ngay[ngay.length - 1] ?? null,
    rows,
    maLa: [...maLa],
    soKhoan,
  };
}
