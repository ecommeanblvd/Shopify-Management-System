/**
 * THUẦN: dựng cấu trúc giá cho 1 đơn ship hộ để đối chiếu 3 con số theo từng khoản:
 *   - Chi phí Carrier DỰ TÍNH (mình trả, từ quoteBreakdown, quy VND).
 *   - Cước TỪ CARRIER (thực, từ hoá đơn carrier đã đối soát — actualBillBreakdown).
 *   - Giá thu khách DỰ TÍNH (tái dùng computeBrandCharge → khớp tuyệt đối chargedVnd).
 * Kèm cân tính phí của từng công thức (quote chargeable vs bill billed weight) để
 * chênh lệch cân lộ ra ngay.
 */
import { computeBrandCharge, type BrandChargeParts } from './brand-pricing';

export interface PriceStructureRow {
  label: string;
  /** Chi phí carrier dự tính (VND). null = khoản này không có bên chi phí. */
  costVnd: number | null;
  /** Cước thực từ hoá đơn carrier (VND). null = chưa có bill hoặc khoản không có. */
  billVnd: number | null;
  /** Giá thu khách DỰ TÍNH — quote lúc khách tạo vận đơn (VND). */
  quoteChargeVnd: number | null;
  /** Giá thu khách THỰC — tính lại theo bill (VND). Chưa có bill = null hoặc = dự tính. */
  chargeVnd: number | null;
  /** % QUOTE cho dòng fuel/VAT (hiển thị phụ) — rate lock lúc báo giá. */
  percent?: number | null;
  /**
   * % HIỆU LỰC carrier áp trên BILL (Change 1, CEO 23/09) — CHỈ dòng "Phụ phí
   * xăng dầu". Khác `percent` (rate lock lúc quote) vì fuel rate đổi hàng tuần:
   * quote khoá rate lúc báo giá, carrier bill theo rate của TUẦN GIAO HÀNG.
   * Suy từ `ab.fuel / billFuelBase` (base = cước cơ bản bill NET + phụ phí cùng
   * đợt — remote/demand/residential/signature; KHÔNG gồm VAT/duty/phí NK/AC vì
   * carrier không tính fuel trên các khoản pass-through này), làm tròn 3 chữ số
   * thập phân (carrier công bố rate kiểu "46.500%"). Đã kiểm read-only trên TOÀN
   * BỘ đơn reconciled ở production (23/09/2026) — công thức này tái tạo đúng
   * `ab.fuel` ở 127/127 đơn; các base khác (chỉ net cước, hoặc lấy thẳng `ab.base`
   * thô) tái tạo được ít hơn hẳn. null = chưa có bill, hoặc base suy ra ≤ 0 —
   * KHÔNG BAO GIỜ bịa % khi không suy được đáng tin.
   */
  billPercent?: number | null;
}

export interface ShipHoPriceStructure {
  rows: PriceStructureRow[];
  costTotal: number;
  /** Tổng giá thu DỰ TÍNH (quote gốc lúc khách tạo vận đơn). */
  quoteChargeTotal: number;
  /** Tổng giá thu THỰC — CHỈ CƯỚC (tính lại theo bill; = dự tính khi chưa có bill). */
  chargeTotal: number;
  /** Thuế/phí NK FedEx ứng hộ trên bill (thu hộ, ngoài cước). 0 = chưa có bill thuế. */
  dutyChargeVnd: number;
  /** Tổng brand phải trả = cước + thuế/phí NK thu hộ (spec §6). */
  chargeWithDutyTotal: number;
  /** Tổng cước bill thực (actualCarrierCostVnd). GỘP duty (cả hoá đơn carrier). null khi chưa đối soát. */
  billTotal: number | null;
  /** Thuế/hải quan trên bill thực (billVnd của dòng duty). null khi chưa có bill; 0 khi có bill nhưng không có duty. */
  dutyBillVnd: number | null;
  /** Cân tính phí từng công thức: quote (chargeable) vs bill (billed weight). */
  weights: { quoteKg: number | null; billKg: number | null };
  /** Hệ số quy cost-currency → VND (carrierCostVnd / breakdown.carrierCost). */
  factor: number;
  /** Số hoá đơn carrier (nếu đã đối soát). */
  billNumber: string | null;
}

/** Nhãn dòng duty — dùng chung giữa nơi dựng `rows` và các hàm tách/tổng bên dưới. */
const NHAN_DUTY = 'Thuế / hải quan (duty) — ngoài cước, thu hộ';

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
};

/** Đọc breakdown (jsonb) → cấu trúc giá 3 phía. null nếu thiếu dữ liệu để quy đổi. */
export function shipHoPriceStructure(input: {
  breakdown: unknown;
  carrierCostVnd: number;
  chargedVnd: number;
  markupPercent: number;
  serviceLabel?: string;
  /** Bill thực (sau đối soát): breakdown VND đã lưu + tổng + cân bill. */
  actualBill?: { breakdown: unknown; totalVnd: number; weightKg: number | null } | null;
}): ShipHoPriceStructure | null {
  const b = input.breakdown as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return null;
  const carrierCost = num(b.carrierCost);
  if (!(carrierCost > 0) || !(input.carrierCostVnd > 0)) return null;

  const factor = input.carrierCostVnd / carrierCost;
  const R = (v: unknown) => Math.round(num(v) * factor);

  // ── Phía CHI PHÍ CARRIER dự tính (mình trả) ──
  const baseCost = R(b.base);
  const fuelCost = R(b.fuel);
  const vatCost = R(b.vat);
  const surCost = R(b.remote) + R(b.perKg) + R(b.demand) + R(b.countryFixed) + R(b.perStep) + R(b.peak) + R(b.residential) + R(b.addons);
  // Phần dư CHI PHÍ (giảm giá / làm tròn) để cột chi phí luôn khớp carrierCostVnd.
  const adjustCost = Math.round(input.carrierCostVnd - (baseCost + surCost + fuelCost + vatCost));

  // ── Phía CƯỚC TỪ CARRIER (bill thực, breakdown đã là VND) ──
  // Cước cơ bản bill = Freight − Base Discount (giá NET carrier offer mình) — để so
  // thẳng hàng với cước cơ bản dự tính (bảng cước mua vào cũng là giá net); giá
  // list + dòng chiết khấu riêng chỉ gây lệch đỏ/xanh ảo từng dòng.
  const ab = (input.actualBill?.breakdown ?? null) as Record<string, unknown> | null;
  const billTotal = input.actualBill ? Math.round(input.actualBill.totalVnd) : null;
  const baseBill = ab ? Math.round(num(ab.base) + num(ab.discount)) : null;
  const fuelBill = ab ? Math.round(num(ab.fuel)) : null;
  const vatBill = ab ? Math.round(num(ab.vat)) : null;
  const surBill = ab ? Math.round(num(ab.remote) + num(ab.demand) + num(ab.signature) + num(ab.residential) + num(ab.other)) : null;
  // duty + AC + NK hiển thị ở DÒNG RIÊNG — phải trừ khỏi phần dư, không thì
  // "điều chỉnh" hiện đúp đúng bằng duty (bill 736xxx gộp vào, bug 03/08).
  const passBill = ab ? Math.round(num(ab.duty) + num(ab.addressCorrection) + num(ab.importHandling)) : null;
  // Phần dư BILL (làm tròn / khoản lạ) để cột bill luôn khớp billTotal.
  const adjustBill = billTotal != null
    ? Math.round(billTotal - ((baseBill ?? 0) + (surBill ?? 0) + (fuelBill ?? 0) + (vatBill ?? 0) + (passBill ?? 0)))
    : null;

  // ── Phía GIÁ THU KHÁCH (tái dùng đúng engine giá brand) ──
  const parts: BrandChargeParts = {
    surchargesVnd: R(b.remote) + R(b.perKg) + R(b.demand) + R(b.countryFixed) + R(b.perStep) + R(b.peak),
    residentialVnd: R(b.residential),
    directSignatureVnd: R(b.addons),
    fuelRealVnd: fuelCost,
    vatRealVnd: vatCost,
  };
  const { lines } = computeBrandCharge({
    carrierCostVnd: input.carrierCostVnd,
    baseVnd: baseCost,
    fuelPercent: num(b.fuelPercent),
    vatPercent: num(b.vatPercent),
    markupPercent: input.markupPercent,
    parts,
    serviceLabel: input.serviceLabel ?? 'Express Delivery',
  });
  const pick = (test: (l: string) => boolean) =>
    lines.filter((l) => test(l.label)).reduce((s, l) => s + l.amountVnd, 0);

  // ── GIÁ THU DỰ TÍNH (quote lúc khách tạo vận đơn) — luôn từ breakdown quote,
  // phụ phí = pass-through cost. Tổng = chargedVnd gốc đã báo brand.
  const qBase = pick((l) => l.startsWith('Cước cơ bản'));
  const qFuel = pick((l) => l === 'Phụ phí xăng dầu');
  const qProcessing = pick((l) => l === 'Phí xử lý đơn hàng');
  const qVat = pick((l) => l === 'VAT');
  const qRemote = R(b.remote);
  const qDemand = R(b.demand);
  // Tách "Giao nhà dân" (residential) và "Ký nhận" (direct signature = addons).
  const qResidential = R(b.residential);
  const qSignature = R(b.addons);
  const qCustoms = R(b.perKg) + R(b.perStep) + R(b.countryFixed) + R(b.peak);
  const quoteTotal = input.chargedVnd;
  const adjustQuoteCharge = Math.round(
    quoteTotal - (qBase + qRemote + qDemand + qResidential + qSignature + qCustoms + qFuel + qProcessing + qVat),
  );

  // ── GIÁ THU THỰC — khi ĐÃ đối soát dùng breakdown THỰC (sell): cước cơ bản theo
  // bảng offer ở cân bill + phụ phí LẤY THEO BILL (gồm residential/ký nhận quote
  // không có) + fuel/VAT công thức FedEx. Chưa có bill → = giá dự tính.
  const sell = (ab?.sell ?? null) as Record<string, unknown> | null;
  const S = (v: unknown) => Math.round(num(v));
  const chargeBase = sell ? S(sell.baseVnd) : qBase;
  const chargeFuel = sell ? S(sell.fuelVnd) : qFuel;
  const chargeProcessing = sell ? S(sell.processingExVatVnd) : qProcessing;
  const chargeVat = sell ? S(sell.vatVnd) : qVat;
  const chRemote = sell ? S(sell.remoteVnd) : qRemote;
  const chDemand = sell ? S(sell.demandVnd) : qDemand;
  // Đơn cũ (sell chưa có 2 field tách) fallback: residential từ quote, signature = phần còn lại.
  const chResidential = sell ? S(sell.residentialVnd ?? 0) : qResidential;
  const chSignature = sell
    ? (sell.signatureVnd != null ? S(sell.signatureVnd) : Math.max(0, S(sell.resSignVnd) - S(sell.residentialVnd ?? 0)))
    : qSignature;
  // Tách NK / duty / other (21/07). Sell cũ chỉ có customsSurVnd → fallback vào dòng NK.
  const qImport = R(b.countryFixed); // engine dự tính phí NK qua countryFixed (vd US 68.300)
  const qOtherSur = R(b.perKg) + R(b.perStep) + R(b.peak);
  const chImport = sell ? S(sell.importHandlingVnd ?? sell.customsSurVnd) : qImport;
  // Duty KHÔNG còn nằm trong `sell.chargedVnd` (spec 21/09 §4.1: thuế/phí NK là khoản THU
  // HỘ, ngoài cước, ghi riêng ở actual_duty_vnd). Cộng nó vào chargeSum thì dòng "Điều
  // chỉnh khớp số đã ghi" hiện một khoản ẢO đúng bằng −duty. Vẫn giữ DÒNG duty để đối
  // chiếu ba phía, nhưng nằm ngoài tổng cước; tổng brand phải trả có dòng riêng cuối bảng.
  const chDuty = sell ? S(sell.dutyVnd ?? 0) : 0;
  const chOther = sell ? S(sell.otherVnd ?? 0) : qOtherSur;
  // Phí sửa địa chỉ: quote không dự tính được (chỉ phát sinh khi địa chỉ sai).
  const chAc = sell ? S(sell.acVnd ?? 0) : 0;
  const chargeTotalFinal = sell ? S(sell.chargedVnd) : quoteTotal;
  const chargeSum = chargeBase + chRemote + chDemand + chResidential + chSignature + chAc + chImport + chOther + chargeFuel + chargeProcessing + chargeVat;
  const adjustCharge = Math.round(chargeTotalFinal - chargeSum);

  // ── Tách phụ phí thành TỪNG KHOẢN. Gộp theo cột bill có sẵn (remote/demand/
  // signature/other) để 3 phía thẳng hàng; cột bill gộp residential+ký nhận vào
  // signature, phí NK/sửa địa chỉ/… vào other. Chỉ hiện dòng có số ở ít nhất 1 phía.
  const hasBill = ab != null;
  const surItems: PriceStructureRow[] = [
    { label: 'Phụ phí vùng xa', costVnd: R(b.remote), billVnd: hasBill ? Math.round(num(ab!.remote)) : null, quoteChargeVnd: qRemote, chargeVnd: chRemote },
    { label: 'Phụ phí nhu cầu (demand)', costVnd: R(b.demand), billVnd: hasBill ? Math.round(num(ab!.demand)) : null, quoteChargeVnd: qDemand, chargeVnd: chDemand },
    {
      label: 'Giao nhà dân',
      costVnd: R(b.residential),
      billVnd: hasBill ? Math.round(num(ab!.residential)) : null,
      quoteChargeVnd: qResidential, chargeVnd: chResidential,
    },
    {
      label: 'Ký nhận (direct signature)',
      costVnd: R(b.addons),
      billVnd: hasBill ? Math.round(num(ab!.signature)) : null,
      quoteChargeVnd: qSignature, chargeVnd: chSignature,
    },
    {
      label: 'Phí sửa địa chỉ (Address Correction)',
      costVnd: null,
      billVnd: hasBill ? Math.round(num(ab!.addressCorrection)) : null,
      quoteChargeVnd: 0, chargeVnd: chAc,
    },
    {
      label: 'Phí xử lý hàng nhập khẩu',
      costVnd: R(b.countryFixed),
      billVnd: hasBill ? Math.round(num(ab!.importHandling ?? ab!.other)) : null, // bill cũ chưa tách → hiện ở đây
      quoteChargeVnd: qImport, chargeVnd: chImport,
    },
    {
      label: NHAN_DUTY,
      costVnd: null, // không dự tính được — pass-through thuần, không VAT
      billVnd: hasBill ? Math.round(num(ab!.duty)) : null,
      quoteChargeVnd: 0, chargeVnd: chDuty,
    },
    {
      label: 'Phụ phí khác (chưa phân loại)',
      costVnd: R(b.perKg) + R(b.perStep) + R(b.peak),
      billVnd: hasBill && ab!.importHandling != null ? Math.round(num(ab!.other)) : null, // bill cũ: other đã hiện ở dòng NK
      quoteChargeVnd: qOtherSur, chargeVnd: chOther,
    },
  ].filter((r) => (r.costVnd ?? 0) !== 0 || (r.billVnd ?? 0) !== 0 || (r.quoteChargeVnd ?? 0) !== 0 || (r.chargeVnd ?? 0) !== 0);

  // % xăng dầu HIỆU LỰC trên bill (Change 1, CEO 23/09) — xem doc-comment
  // `PriceStructureRow.billPercent`. base = cước cơ bản bill NET + phụ phí cùng
  // đợt (remote/demand/residential/signature); base ≤ 0 → null, không bịa %.
  const fuelBillPercent = hasBill && fuelBill != null
    ? (() => {
        const base = Math.round((baseBill ?? 0) + num(ab!.remote) + num(ab!.demand) + num(ab!.residential) + num(ab!.signature));
        if (!(base > 0)) return null;
        const pct = Math.round((fuelBill / base) * 100 * 1000) / 1000;
        return Number.isFinite(pct) ? pct : null;
      })()
    : null;

  const rows: PriceStructureRow[] = [
    { label: 'Cước cơ bản', costVnd: baseCost, billVnd: baseBill, quoteChargeVnd: qBase, chargeVnd: chargeBase },
    ...surItems,
    { label: 'Phụ phí xăng dầu', costVnd: fuelCost, billVnd: fuelBill, quoteChargeVnd: qFuel, chargeVnd: chargeFuel, percent: num(b.fuelPercent) || null, billPercent: fuelBillPercent },
    { label: 'Phí xử lý đơn hàng', costVnd: null, billVnd: null, quoteChargeVnd: qProcessing, chargeVnd: chargeProcessing },
    { label: 'VAT', costVnd: vatCost, billVnd: vatBill, quoteChargeVnd: qVat, chargeVnd: chargeVat, percent: num(b.vatPercent) || null },
  ];
  if (adjustCost !== 0 || adjustCharge !== 0 || adjustQuoteCharge !== 0 || (adjustBill != null && adjustBill !== 0)) {
    rows.push({
      label: 'Điều chỉnh khớp số đã ghi',
      costVnd: adjustCost || null,
      billVnd: adjustBill != null && adjustBill !== 0 ? adjustBill : null,
      quoteChargeVnd: adjustQuoteCharge || null,
      chargeVnd: adjustCharge || null,
    });
  }
  // Dòng tổng hợp "Tổng brand phải trả = cước + thuế/phí NK thu hộ" ĐÃ GỠ (Change 2,
  // CEO 23/09) — cả 3 nơi hiển thị bảng giá (trang chi tiết, modal đối soát dùng chung
  // `StructureDetail`, trang danh sách qua cùng modal) giờ tự dựng "Tổng cuối" bằng
  // `shipHoFinalTotal(s)` (= `chargeWithDutyTotal` bên dưới), nên dòng này chỉ còn là
  // dữ liệu trùng lặp trong `rows` — đã rà mọi consumer (grep toàn repo) trước khi gỡ,
  // không còn ai đọc theo `label` cũ nữa.

  return {
    rows,
    costTotal: input.carrierCostVnd,
    quoteChargeTotal: quoteTotal,
    chargeTotal: chargeTotalFinal,
    dutyChargeVnd: chDuty,
    chargeWithDutyTotal: chargeTotalFinal + chDuty,
    billTotal,
    dutyBillVnd: hasBill ? Math.round(num(ab!.duty)) : null,
    weights: {
      quoteKg: numOrNull(b.chargeableWeightKg),
      billKg: input.actualBill?.weightKg ?? null,
    },
    factor,
    billNumber: ab && typeof ab.billNumber === 'string' ? ab.billNumber : null,
  };
}

/** Một dòng tổng hợp (subtotal/total) của bảng cấu trúc giá — đủ 4 cột + margin. */
export interface ShipHoPriceTotalRow {
  label: string;
  costVnd: number;
  billVnd: number | null;
  quoteChargeVnd: number;
  chargeVnd: number;
  /** Margin = giá thu − giá chi (ưu tiên bill thực, dự tính khi chưa có bill). */
  marginVnd: number;
}

/**
 * "Tổng cước" — subtotal CHỈ CƯỚC, KHÔNG gồm thuế/hải quan (duty) thu hộ.
 * Cột chi/thu tái dùng nguyên costTotal/quoteChargeTotal/chargeTotal (đã đúng
 * nghĩa "chỉ cước" — xem doc-comment `chargeTotal`); cột bill phải TRỪ phần
 * duty ra khỏi `billTotal`, vì `billTotal` là CẢ hoá đơn carrier (gộp duty) —
 * đây chính là root cause bug cũ (margin tổng trừ nhầm bill có duty vào cước
 * không có duty). Chưa có bill (`billTotal` null) → margin dùng chi phí dự tính.
 */
export function shipHoFreightSubtotal(s: ShipHoPriceStructure): ShipHoPriceTotalRow {
  const billVnd = s.billTotal == null ? null : s.billTotal - (s.dutyBillVnd ?? 0);
  return {
    label: 'Tổng cước',
    costVnd: s.costTotal,
    billVnd,
    quoteChargeVnd: s.quoteChargeTotal,
    chargeVnd: s.chargeTotal,
    marginVnd: s.chargeTotal - (billVnd ?? s.costTotal),
  };
}

/**
 * "Tổng cuối" — Tổng cước + Thuế/hải quan (duty) thu hộ, ở CẢ hai cột chi lẫn
 * thu (bill đã gồm sẵn duty; charge dùng `chargeWithDutyTotal`).
 *
 * Vì duty được thu ĐÚNG GIÁ VỐN (không markup — `dutyChargeVnd` phải bằng
 * `dutyBillVnd`, cùng lấy từ một số trên hoá đơn), duty cộng như nhau vào cả
 * tử số (thu) lẫn mẫu số (chi) nên KHÔNG đổi margin so với `shipHoFreightSubtotal`.
 * Đây là điểm cốt lõi của layout: gộp duty vào phải giữ nguyên margin, để người
 * đọc thấy ngay duty đi qua sổ sách sạch sẽ. Nếu hai margin lệch nhau, có nghĩa
 * `sell.dutyVnd` (ghi lúc đối soát) khác số duty thực trên bill — báo lại, đừng
 * tự vá ở đây.
 */
export function shipHoFinalTotal(s: ShipHoPriceStructure): ShipHoPriceTotalRow {
  return {
    label: 'Tổng cuối',
    costVnd: s.costTotal,
    billVnd: s.billTotal,
    quoteChargeVnd: s.quoteChargeTotal,
    chargeVnd: s.chargeWithDutyTotal,
    marginVnd: s.chargeWithDutyTotal - (s.billTotal ?? s.costTotal),
  };
}

/**
 * Tách `rows` thành khối cước (freight, để render các dòng freight KHÔNG đổi)
 * và dòng duty riêng (render dưới subtotal "Tổng cước", trước "Tổng cuối").
 * `rows` không còn dòng tổng hợp cũ (gỡ ở Change 2 — xem ghi chú trong
 * `shipHoPriceStructure`) nên filter ở đây chỉ còn cần tách đúng dòng duty.
 */
export function shipHoFreightAndDutyRows(
  s: ShipHoPriceStructure,
): { freightRows: PriceStructureRow[]; dutyRow: PriceStructureRow | null } {
  const dutyRow = s.rows.find((r) => r.label === NHAN_DUTY) ?? null;
  const freightRows = s.rows.filter((r) => r.label !== NHAN_DUTY);
  return { freightRows, dutyRow };
}

/**
 * Margin của MỘT dòng trong bảng = thu − chi (chargeVnd/quoteChargeVnd và
 * billVnd/costVnd đều coi thiếu = 0, giống cách các cột số khác trong bảng vẫn
 * hiện — ví dụ dòng "Điều chỉnh khớp số đã ghi" chỉ có billVnd, không có
 * chargeVnd, vẫn phải tính margin = 0 − billVnd, không phải bỏ trắng).
 *
 * Sửa bug: dòng KHÔNG có khái niệm chi phí/bill carrier nào cả (costVnd VÀ
 * billVnd đều null — ví dụ "Phí xử lý đơn hàng", phí riêng của MEAN không qua
 * carrier) phải có margin = TOÀN BỘ khoản thu, không phải "—" (trước đây
 * `billVnd == null` bị hiểu nhầm thành "chưa biết" thay vì "không áp dụng").
 * `billVnd == null` chỉ có nghĩa "không áp dụng chi phí" khi `costVnd` cũng
 * null; nếu dòng có `costVnd` nhưng bill riêng dòng đó chưa có, rơi về dùng
 * cost dự tính thay vì bỏ trắng.
 */
export function shipHoRowMarginVnd(row: PriceStructureRow, hasBill: boolean): number | null {
  if (!hasBill) return (row.quoteChargeVnd ?? 0) - (row.costVnd ?? 0);
  const charge = row.chargeVnd ?? 0;
  if (row.billVnd == null && row.costVnd == null) return charge;
  return charge - (row.billVnd ?? row.costVnd ?? 0);
}
