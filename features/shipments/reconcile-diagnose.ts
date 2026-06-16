/**
 * Pure invoice-diagnosis layer for ship-cost reconciliation.
 *
 * Decomposes the billed-vs-engine delta down to the dong, attributes each
 * dong to a cause, and reverse-engineers the weight tier the carrier billed
 * at. No DB / no engine objects — takes plain numbers so it is unit-testable.
 *
 * Zero tolerance: a row "matches" only when totalDelta === 0. Any residual
 * after explaining every component lands in an explicit `residual` line
 * (LAM_TRON), never hidden under a tolerance band. By construction:
 *   Σ components[].delta === totalDelta   (the reconciliation identity)
 */

export type DiagnosisCause =
  | 'KHOP'
  | 'SAI_CAN'
  | 'THIEU_CAU_HINH_REMOTE'
  | 'REMOTE_KHONG_KHOP'
  | 'LECH_RATE_CARD'
  | 'LECH_CHIET_KHAU'
  | 'LECH_FUEL'
  | 'LECH_FUEL_BASE'
  | 'SAI_ZONE'
  | 'PHAI_SINH_ZONE'
  | 'PHI_TUY_CHON'
  | 'PHAI_SINH'
  | 'KHONG_KHOP'
  | 'LAM_TRON';

export type DiagnosisSeverity =
  | 'match' | 'weight' | 'zone' | 'config' | 'ratecard' | 'discount' | 'rounding'
  /** Lệch chỉ gồm phí dịch vụ opt-in (ký nhận) hóa đơn thu thêm — đúng billing. */
  | 'passthrough';

export type ComponentKey =
  | 'base' | 'discount' | 'fuel' | 'remote' | 'demand'
  | 'signature' | 'residential' | 'addressCorrection' | 'vat' | 'gogreen' | 'elevatedRisk' | 'residual';

export interface ComponentDelta {
  key: ComponentKey;
  billed: number;
  engine: number;
  delta: number;
  cause: DiagnosisCause;
}

export interface ImpliedWeight {
  tierUpperKg: number;
  rangeKg: [number, number];
  engineChargeableKg: number;
  deltaTiers: number;
}

/** Cross-zone inversion result — the carrier appears to have billed the
 *  destination under a DIFFERENT zone than our country→zone map. */
export interface ImpliedZone {
  /** Zone whose NET ladder matches the billed net base exactly. */
  zoneLabel: string;
  /** Zone our country→zone map placed the destination in. */
  engineZoneLabel: string;
  /** Weight tier where the exact rate match was found. */
  tierUpperKg: number;
}

export interface ReconcileDiagnosis {
  totalDelta: number;
  components: ComponentDelta[];
  impliedWeight: ImpliedWeight | null;
  impliedZone: ImpliedZone | null;
  verdict: string;
  severity: DiagnosisSeverity;
}

export interface DiagnoseInput {
  billed: {
    base: number | null; discount: number | null; fuel: number | null;
    remote: number | null; demand: number | null; signature: number | null;
    /** Phí giao địa chỉ nhà dân (FedEx Residential) — dòng RIÊNG với signature. */
    residential?: number | null;
    /** Phí FedEx sửa địa chỉ sai (Address Correction) — pass-through hợp lệ. */
    addressCorrection?: number | null;
    vat: number | null; gogreen: number | null; elevatedRisk: number | null;
    /** Billed import/clearance handling — counterpart of engine
     *  country_fixed alongside elevatedRisk (FedEx US import handling). */
    importHandling?: number | null;
    total: number;
  };
  engine: {
    base: number; discount: number; fuel: number; remote: number;
    demand: number; residential: number; vat: number; total: number;
    /**
     * Peak/Premium (`peak_fixed`) — Premium only since 2026-06-11 (DHL
     * Direct Signature re-kinded to `addon_fixed`). No longer folded into
     * the signature line; usually 0.
     */
    peak?: number;
    /** Dịch vụ bổ sung always (DHL Direct Signature). Nguồn dòng signature. */
    addons?: number;
    /** Giá tham chiếu addon when_billed (FedEx) — kiểm giá pass-through. */
    addonReference?: number;
    /** Addon bị MIỄN ở nước đích (excluded_country_codes) — carrier KHÔNG
     *  được thu; bill có phí ⇒ khiếu nại, không phải pass-through. */
    addonExcludedForCountry?: boolean;
    /**
     * DHL GoGreen is a `per_step_fixed` surcharge (FedEx has none — always 0).
     * Reconciles against the billed `gogreen` line.
     */
    perStep?: number;
    /**
     * Engine country_fixed surcharge (DHL Elevated Risk / Restricted
     * Destination). Reconciles against the billed `elevatedRisk` line.
     */
    countryFixed?: number;
    /** Giá tham chiếu country_fixed when_billed (FedEx US import handling) —
     *  engine KHÔNG tự cộng; kiểm giá pass-through dòng elevatedRisk. */
    countryFixedReference?: number;
  };
  engineChargeableWeightKg: number;
  engineTierUpperKg: number;
  /** Package-appropriate gross list rate ladder, ascending by upperKg. */
  zoneRates: Array<{ upperKg: number; rate: number }>;
  /** Label of the zone our country→zone map resolved (display only). */
  engineZoneLabel?: string;
  /** NET ladders of every OTHER zone on the same rate card, for the
   *  cross-zone inversion. Optional — empty disables the check. */
  otherZoneRates?: Array<{ zoneLabel: string; rates: Array<{ upperKg: number; rate: number }> }>;
  /** base + fuelable surcharges on the BILLED side (engine isFuelable rule). */
  billedFuelableBase: number;
  fuelPercent: number;
  discountPercent: number;
  vatPercent: number;
  /** Nước đích (ISO-2) — chỉ dùng cho verdict (vd nước miễn addon). */
  shipCountry?: string;
  /** Phân loại địa chỉ người nhận (FedEx Address Validation): BUSINESS mà bị
   *  thu residential ⇒ FedEx thu sai ⇒ flag KHONG_KHOP (đòi NCC). */
  residentialClass?: string | null;
}

const r = (n: number): number => Math.round(n);
const n0 = (v: number | null | undefined): number => (v == null ? 0 : v);

/** Invert a billed gross base into a weight tier (exact list-rate match). */
function invertWeight(
  billedBase: number,
  zoneRates: Array<{ upperKg: number; rate: number }>,
  engineTierUpperKg: number,
  engineChargeableKg: number,
): { cause: 'SAI_CAN' | 'LECH_RATE_CARD'; implied: ImpliedWeight | null } {
  const idx = zoneRates.findIndex((z) => r(z.rate) === r(billedBase));
  if (idx < 0) return { cause: 'LECH_RATE_CARD', implied: null };
  const tier = zoneRates[idx];
  if (tier.upperKg === engineTierUpperKg) {
    // Same tier, different price — that's a card mismatch, not weight.
    return { cause: 'LECH_RATE_CARD', implied: null };
  }
  // Heavier OR lighter tier both count as weight evidence: carrier billed
  // a different chargeable weight (heavier = their scale/dim caught more;
  // lighter = our ops dims overstate the pack — see #MBLVD28074 where the
  // GoGreen step count independently confirmed the carrier's 3 kg).
  const prevUpper = idx > 0 ? zoneRates[idx - 1].upperKg : 0;
  const engineIdx = zoneRates.findIndex((z) => z.upperKg === engineTierUpperKg);
  const deltaTiers = engineIdx >= 0 ? idx - engineIdx : (tier.upperKg > engineTierUpperKg ? 1 : -1);
  return {
    cause: 'SAI_CAN',
    implied: {
      tierUpperKg: tier.upperKg,
      rangeKg: [prevUpper, tier.upperKg],
      engineChargeableKg,
      deltaTiers,
    },
  };
}

/** Invert a billed net base across OTHER zones' NET ladders. Exact rate
 *  match only; prefers the tier closest to the engine's tier so a same-tier
 *  zone swap beats a zone+weight coincidence. */
function invertZone(
  billedNetBase: number,
  otherZoneRates: Array<{ zoneLabel: string; rates: Array<{ upperKg: number; rate: number }> }>,
  engineTierUpperKg: number,
): { zoneLabel: string; tierUpperKg: number } | null {
  let best: { zoneLabel: string; tierUpperKg: number } | null = null;
  let bestDist = Infinity;
  for (const z of otherZoneRates) {
    for (const t of z.rates) {
      if (r(t.rate) !== r(billedNetBase)) continue;
      const dist = Math.abs(t.upperKg - engineTierUpperKg);
      if (dist < bestDist) { bestDist = dist; best = { zoneLabel: z.zoneLabel, tierUpperKg: t.upperKg }; }
    }
  }
  return best;
}

export function diagnoseReconcileRow(input: DiagnoseInput): ReconcileDiagnosis {
  const b = input.billed;
  const e = input.engine;
  const totalDelta = r(b.total - e.total);

  const components: ComponentDelta[] = [];
  let impliedWeight: ImpliedWeight | null = null;
  let impliedZone: ImpliedZone | null = null;

  // base — compare NET vs NET. The FedEx invoice expresses base as a high
  // published "list" figure minus a discount line; the base actually applied
  // to the account = list − discount. Our rate card stores those NET account
  // rates, so BOTH the weight inversion and the base delta run on the NET
  // basis (billedBase + billedDiscount; discount is stored negative). The
  // discount is therefore folded into the base line, not a separate component.
  const billedNetBase = r(n0(b.base) + n0(b.discount));
  const engineNetBase = r(e.base - e.discount);
  const baseDelta = r(billedNetBase - engineNetBase);
  let baseCause: DiagnosisCause = 'KHOP';
  if (baseDelta !== 0) {
    if (billedNetBase <= 0) {
      baseCause = 'KHONG_KHOP';
    } else {
      const inv = invertWeight(billedNetBase, input.zoneRates, input.engineTierUpperKg, input.engineChargeableWeightKg);
      baseCause = inv.cause;
      impliedWeight = inv.implied;
      // Same-zone inversion found nothing -> does the billed net base sit on
      // ANOTHER zone's ladder? (e.g. FedEx billed Monaco at Zone M while our
      // map says Zone E — verified on #MBLVD28869, 2026-06-10.)
      if (inv.cause === 'LECH_RATE_CARD' && (input.otherZoneRates?.length ?? 0) > 0) {
        const zHit = invertZone(billedNetBase, input.otherZoneRates!, input.engineTierUpperKg);
        if (zHit) {
          baseCause = 'SAI_ZONE';
          impliedZone = {
            zoneLabel: zHit.zoneLabel,
            engineZoneLabel: input.engineZoneLabel ?? '',
            tierUpperKg: zHit.tierUpperKg,
          };
        }
      }
    }
  }
  components.push({ key: 'base', billed: billedNetBase, engine: engineNetBase, delta: baseDelta, cause: baseCause });

  // remote
  const remBilled = n0(b.remote);
  const remDelta = r(remBilled - e.remote);
  let remCause: DiagnosisCause = 'KHOP';
  if (remDelta !== 0) {
    remCause = remBilled > 0 && e.remote === 0 ? 'THIEU_CAU_HINH_REMOTE' : 'REMOTE_KHONG_KHOP';
  }
  components.push({ key: 'remote', billed: remBilled, engine: e.remote, delta: remDelta, cause: remCause });

  // fuel — FedEx is inconsistent about whether the Demand surcharge sits
  // inside the fuel base (measured 2026-06-10 across 1,362 invoices:
  // ~2:1 include vs exclude, no date cutoff). Accept EITHER basis when
  // checking the implied %, so a clean carrier % never flags as LECH_FUEL.
  const fuelBilled = n0(b.fuel);
  const fuelDelta = r(fuelBilled - e.fuel);
  let fuelCause: DiagnosisCause = 'KHOP';
  if (fuelDelta !== 0) {
    // Carrier fuel base = net base + remote + (per-carrier subset of
    // demand / signature). FedEx fuels signature + demand (verified GB
    // order 2026-06-10: 45.25% × (net+remote+signature)); DHL fuels
    // base + ER only. Try every combination so a correct carrier %
    // is always recognised.
    const c0 = input.billedFuelableBase;
    // DHL fuels Elevated Risk; FedEx fuels demand + signature + RESIDENTIAL
    // (đo: billed fuel base = net+signature+residential). Thử mọi tổ hợp 4 add
    // (2^4=16) để % carrier đúng luôn được nhận.
    const adds = [n0(b.demand), n0(b.signature), n0(b.residential), n0(b.elevatedRisk) + n0(b.importHandling ?? null)];
    const candidates = [...new Set(
      Array.from({ length: 16 }, (_, mask) =>
        c0 + adds.reduce((sum, a, i) => sum + ((mask >> i) & 1 ? a : 0), 0)),
    )];
    const pctMatches = candidates.some((base) =>
      base > 0 && Math.abs((fuelBilled / base) * 100 - input.fuelPercent) < 0.05);
    if (!pctMatches) {
      fuelCause = 'LECH_FUEL';
    } else {
      // % is right — is the gap DOWNSTREAM of a flagged base/remote line
      // (zone/weight/ratecard), or does fuel ride a different BASE
      // COMPOSITION (e.g. carrier fuels the demand surcharge, we don't)?
      const upstreamFlagged = components.some(
        (c) => (c.key === 'base' || c.key === 'remote') && c.cause !== 'KHOP');
      // Phí opt-in mà ENGINE chưa cộng (engine side = 0) làm billed fuel base
      // RỘNG hơn đúng bằng phí đó → fuel chênh là PHÁI SINH, không phải lỗi %.
      // Tách RIÊNG signature vs residential: signature có thể đã ở engine
      // (addons>0) trong khi residential vẫn pass-through (engine=0) — như đơn
      // có ký nhận + giao nhà dân. Mỗi phần xét theo engine của CHÍNH nó.
      const resiPass = n0(b.residential) > 0 && r(e.residential) === 0 ? n0(b.residential) : 0;
      const sigPass = n0(b.signature) > 0 && r(n0(e.addons ?? null)) === 0 ? n0(b.signature) : 0;
      const passFee = resiPass + sigPass;
      // FedEx có khi fuel cả Demand (đo #MBLVD28665). Nhận cả: chỉ pass-through,
      // hoặc pass-through + demand (khi demand khớp).
      const demandMatched = r(n0(b.demand) - e.demand) === 0;
      const extraFueled = passFee + (demandMatched ? n0(b.demand) : 0);
      const explainedBySig = passFee > 0 && (
        Math.abs(fuelDelta - (input.fuelPercent / 100) * passFee) <= 2
        || Math.abs(fuelDelta - (input.fuelPercent / 100) * extraFueled) <= 2);
      // Supplementary-bill ER: the line itself matches (billed flat = engine)
      // but the bill did NOT fuel it while the standard formula does —
      // fuelDelta = -% × ER exactly. Derived, not a fuel-base config issue.
      const erBoth = n0(b.elevatedRisk) + n0(b.importHandling ?? null);
      const explainedByUnfueledEr = erBoth > 0
        && r(erBoth) === r(n0(e.countryFixed ?? null))
        && Math.abs(fuelDelta + (input.fuelPercent / 100) * erBoth) <= 2;
      fuelCause = upstreamFlagged
        ? (impliedZone ? 'PHAI_SINH_ZONE' : 'PHAI_SINH')
        : (explainedBySig || explainedByUnfueledEr) ? 'PHAI_SINH' : 'LECH_FUEL_BASE';
    }
  }
  components.push({ key: 'fuel', billed: fuelBilled, engine: e.fuel, delta: fuelDelta, cause: fuelCause });

  // demand
  const demBilled = n0(b.demand);
  const demDelta = r(demBilled - e.demand);
  components.push({ key: 'demand', billed: demBilled, engine: e.demand, delta: demDelta, cause: demDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // signature — engine = addon_fixed (DHL always / FedEx when_billed). Residential
  // KHÔNG còn fold ở đây (dòng riêng bên dưới) để đối soát không bị lẫn.
  const sigBilled = n0(b.signature);
  const sigEngine = r(n0(e.addons ?? null));
  const sigDelta = r(sigBilled - sigEngine);
  let sigCause: DiagnosisCause = sigDelta === 0 ? 'KHOP' : 'KHONG_KHOP';
  // Opt-in theo đơn (FedEx): chấp nhận pass-through CHỈ KHI số học fuel khớp
  // VÀ giá đúng bảng addon when_billed (addonReference). Chưa khai giá
  // (reference = 0) giữ hành vi cũ — không chặt hơn với carrier chưa cấu hình.
  const fuelComp = components.find((c) => c.key === 'fuel');
  const sigRef = n0(e.addonReference ?? null);
  // Đã có trên bill = dịch vụ ĐƯỢC dùng → công nhận pass-through, KỂ CẢ nước
  // "miễn" (miễn chỉ là không auto-thu, không phải không bao giờ thu). Vẫn kiểm
  // đúng giá tham chiếu để bắt sai số tiền.
  if (sigDelta > 0 && sigEngine === 0 && fuelComp && fuelComp.cause !== 'LECH_FUEL'
      && (sigRef === 0 || sigBilled === sigRef)) {
    sigCause = 'PHI_TUY_CHON';
  }
  components.push({ key: 'signature', billed: sigBilled, engine: sigEngine, delta: sigDelta, cause: sigCause });

  // residential — phí giao địa chỉ nhà dân (FedEx "Residential Delivery"), dịch
  // vụ RIÊNG với ký nhận. Engine không tự định giá (2 biến thể rate 80.100/84.400
  // cùng kỳ, không suy ra độc lập được) → bill có ⇒ pass-through hợp lệ. Tách
  // dòng để 25115… không còn lệch giả ở "signature".
  const resiBilled = n0(b.residential);
  const resiEngine = r(e.residential);
  const resiDelta = r(resiBilled - resiEngine);
  let resiCause: DiagnosisCause = resiDelta === 0 ? 'KHOP' : 'KHONG_KHOP';
  if (resiBilled > 0 && resiEngine === 0) {
    // Xác minh bằng FedEx Address Validation: địa chỉ BUSINESS mà bị thu
    // residential ⇒ thu SAI ⇒ đòi NCC (KHONG_KHOP). RESIDENTIAL / chưa
    // classify ⇒ pass-through hợp lệ.
    resiCause = input.residentialClass === 'BUSINESS' ? 'KHONG_KHOP' : 'PHI_TUY_CHON';
  }
  components.push({ key: 'residential', billed: resiBilled, engine: resiEngine, delta: resiDelta, cause: resiCause });

  // addressCorrection — phí FedEx sửa địa chỉ sai (khách nhập thiếu/sai). Engine
  // KHÔNG định giá (pass-through). Có bill → khoản hợp lệ (PHI_TUY_CHON), không
  // phải FedEx thu sai; tách khỏi residual để đối soát không báo lệch giả.
  const acBilled = n0(b.addressCorrection ?? null);
  if (acBilled > 0) {
    components.push({ key: 'addressCorrection', billed: acBilled, engine: 0, delta: acBilled, cause: 'PHI_TUY_CHON' });
  }

  // Phí nhập khẩu (FedEx US) bị gộp trong cột VAT của bill (VAT phẳng 8% —
  // spec 2026-06-11). Bóc ra khi engine CÓ phí nhập (countryFixed>0) NHƯNG
  // bill không để ở cột riêng (importHandling/elevatedRisk = 0) → phần dư
  // trong cột VAT chính là phí nhập. Đơn thường: countryFixed=0 → không bóc.
  // Bất biến Σ giữ nguyên: trueVat + importBundled === cột VAT gốc.
  let vatBilled = n0(b.vat);
  let importBundled = 0;
  if (input.vatPercent > 0 && r(n0(e.countryFixed ?? null)) > 0
      && n0(b.importHandling ?? null) === 0 && n0(b.elevatedRisk) === 0) {
    const trueVat = r(b.total * input.vatPercent / (100 + input.vatPercent));
    const excess = r(vatBilled - trueVat);
    if (Math.abs(excess) > 1000) { importBundled = excess; vatBilled = trueVat; }
  }

  // vat
  const vatDelta = r(vatBilled - e.vat);
  let vatCause: DiagnosisCause = 'KHOP';
  if (vatDelta !== 0) {
    // VAT is derived from the post-discount subtotal — treat as downstream.
    // Under a zone mismatch, verify it against the BILLED pre-VAT sum: if
    // it reproduces exactly, it is pure fallout of the zone difference.
    vatCause = 'PHAI_SINH';
    if (impliedZone && input.vatPercent > 0) {
      const billedPreVat = billedNetBase + n0(b.remote) + n0(b.demand) + n0(b.signature)
        + n0(b.residential) + n0(b.gogreen) + n0(b.elevatedRisk) + fuelBilled;
      if (Math.abs(vatBilled - billedPreVat * (input.vatPercent / 100)) <= 2) {
        vatCause = 'PHAI_SINH_ZONE';
      }
    }
  }
  components.push({ key: 'vat', billed: vatBilled, engine: e.vat, delta: vatDelta, cause: vatCause });

  // gogreen — engine side = per_step_fixed (DHL GoGreen, 1.900 VND × every
  // 0.5 kg step). FedEx has no per_step row -> engine 0.
  const ggBilled = n0(b.gogreen);
  const ggEngine = r(n0(e.perStep ?? null));
  const ggDelta = r(ggBilled - ggEngine);
  components.push({ key: 'gogreen', billed: ggBilled, engine: ggEngine, delta: ggDelta, cause: ggDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // elevatedRisk — engine side = country_fixed (DHL Elevated Risk /
  // Restricted Destination). A mismatch usually means the surcharge's
  // effective window or country list is off vs what the carrier billed.
  const erBilled = r(n0(b.elevatedRisk) + n0(b.importHandling ?? null) + importBundled);
  const erEngine = r(n0(e.countryFixed ?? null));
  const erRef = r(n0(e.countryFixedReference ?? null));
  const erDelta = r(erBilled - erEngine);
  let erCause: DiagnosisCause = erDelta === 0 ? 'KHOP' : 'KHONG_KHOP';
  // Phí xử lý hàng nhập opt-in (FedEx US): engine không tự cộng (when_billed).
  // Bill có + đúng giá tham chiếu → pass-through hợp lệ; sai giá → flag.
  if (erEngine === 0 && erBilled > 0 && erRef > 0) {
    erCause = erBilled === erRef ? 'PHI_TUY_CHON' : 'KHONG_KHOP';
  }
  components.push({ key: 'elevatedRisk', billed: erBilled, engine: erEngine, delta: erDelta, cause: erCause });

  // residual = whatever is left so the identity holds exactly.
  const explained = components.reduce((a, c) => a + c.delta, 0);
  const residual = r(totalDelta - explained);
  // ±100đ covers per-line rounding accumulation; anything bigger is a real
  // unexplained gap and must not hide behind a 'làm tròn' label.
  const residualCause: DiagnosisCause = residual === 0 ? 'KHOP' : Math.abs(residual) <= 100 ? 'LAM_TRON' : 'KHONG_KHOP';
  components.push({ key: 'residual', billed: 0, engine: 0, delta: residual, cause: residualCause });

  // verdict — weight inversion always headlines (it's the strongest evidence);
  // otherwise the LARGEST-magnitude actionable component drives the headline,
  // so the operator sees the dominant cause first rather than a fixed order.
  let verdict: string;
  let severity: DiagnosisSeverity;
  if (totalDelta === 0) {
    verdict = 'KHỚP TUYỆT ĐỐI (0đ)';
    severity = 'match';
  } else if (impliedWeight && components.some((c) => c.cause === 'SAI_CAN')) {
    const [lo, hi] = impliedWeight.rangeKg;
    verdict = impliedWeight.deltaTiers >= 0
      ? `Carrier tính ở mức cân cao hơn: ${lo}–${hi} kg (bậc ≤ ${hi} kg) vs hệ thống ${impliedWeight.engineChargeableKg} kg`
      : `Carrier tính ở mức cân THẤP hơn: bậc ≤ ${hi} kg vs hệ thống ${impliedWeight.engineChargeableKg} kg — kiểm tra lại kích thước/dim trên ops sheet`;
    severity = 'weight';
  } else if (impliedZone && components.some((c) => c.cause === 'SAI_ZONE')) {
    verdict = `⚠ Carrier bill theo ${impliedZone.zoneLabel} (bậc ≤ ${impliedZone.tierUpperKg} kg)` +
      ` — hệ thống đang map nước này vào ${impliedZone.engineZoneLabel}.` +
      ' Cần xác nhận zone mapping với carrier trước khi cập nhật.';
    severity = 'zone';
  } else {
    // PHAI_SINH (downstream of base) and KHOP never headline.
    const actionable = components
      .filter((c) => c.cause !== 'KHOP' && c.cause !== 'PHAI_SINH'
        && c.cause !== 'PHAI_SINH_ZONE' && c.cause !== 'LAM_TRON' && c.cause !== 'PHI_TUY_CHON')
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const dominant = actionable[0];
    if (!dominant) {
      const optIn = components.find((c) => c.cause === 'PHI_TUY_CHON');
      // Nhãn phí opt-in theo dòng: signature = phí ký nhận, elevatedRisk
      // (FedEx US) = phí xử lý hàng nhập — không gọi nhầm tên.
      const optInLabel = optIn?.key === 'elevatedRisk' ? 'phí xử lý hàng nhập' : 'phí ký nhận';
      // Supplementary-bill ER pattern: ER line matches, fuel gap = -%×ER,
      // and the billed VAT reproduces on the ER-excluded basis — the
      // carrier charged the ER flat (no fuel, no VAT). Favorable.
      const erBothV = n0(b.elevatedRisk) + n0(b.importHandling ?? null);
      const fuelC = components.find((c) => c.key === 'fuel');
      const erUnfueled = erBothV > 0
        && components.find((c) => c.key === 'elevatedRisk')?.delta === 0
        && fuelC !== undefined && fuelC.delta < 0
        && Math.abs(fuelC.delta + (input.fuelPercent / 100) * erBothV) <= 2
        && (input.vatPercent <= 0 || Math.abs(
          n0(b.vat) - (input.vatPercent / 100) * (billedNetBase + n0(b.remote) + n0(b.demand)
            + n0(b.signature) + n0(b.gogreen) + n0(b.fuel))) <= 2);
      if (optIn) {
        verdict = `Khớp — hóa đơn thu thêm ${optInLabel} opt-in ${optIn.delta.toLocaleString('vi-VN')}đ (+fuel/VAT theo), số học khớp`;
        severity = 'passthrough';
      } else if (erUnfueled) {
        verdict = `Hóa đơn KHÔNG tính fuel/VAT trên ER ${erBothV.toLocaleString('vi-VN')}đ — số học tự khớp, chênh ${Math.abs(r(totalDelta)).toLocaleString('vi-VN')}đ có lợi; đối chiếu lại hóa đơn gốc trước khi chốt`;
        severity = 'passthrough';
      } else {
        verdict = `Chỉ lệch do làm tròn (${residual}đ)`;
        severity = 'rounding';
      }
    } else if (dominant.key === 'elevatedRisk' && r(n0(e.countryFixed ?? null)) === 0
        && r(n0(e.countryFixedReference ?? null)) > 0 && dominant.delta > 0) {
      // FedEx US import handling when_billed: engine không tự cộng, bill có
      // nhưng SAI giá so với bảng tham chiếu → khiếu nại carrier.
      verdict = `Phí xử lý hàng nhập sai bảng giá: bill ${dominant.billed.toLocaleString('vi-VN')}đ ≠ ${r(n0(e.countryFixedReference ?? null)).toLocaleString('vi-VN')}đ — đối chiếu với carrier`;
      severity = 'config';
    } else if (dominant.key === 'elevatedRisk') {
      verdict = dominant.delta < 0
        ? 'Hệ thống tính phụ phí rủi ro (ER) nhưng hóa đơn không thu — kiểm tra ngày hiệu lực / danh sách nước'
        : 'Hóa đơn thu phụ phí rủi ro (ER) nhưng hệ thống không tính — kiểm tra danh sách nước áp dụng';
      severity = 'config';
    } else if (dominant.key === 'signature' && dominant.delta < 0
        && !e.addonExcludedForCountry) {
      // Engine tính ký nhận (always) nhưng hóa đơn không thu.
      verdict = 'Hệ thống tính phí ký nhận nhưng hóa đơn không thu — kiểm tra (đơn lẽ ra phải có ký nhận?)';
      severity = 'config';
    } else if (dominant.key === 'signature' && n0(e.addonReference ?? null) > 0
        // Giá ĐÚNG bảng nhưng vẫn dominant (vd gate fuel chặn PHI_TUY_CHON):
        // không in "X ≠ X" tự mâu thuẫn — rơi xuống verdict mặc định.
        && dominant.billed !== n0(e.addonReference ?? null)) {
      verdict = `Direct Signature sai bảng giá: bill ${dominant.billed.toLocaleString('vi-VN')}đ ≠ ${n0(e.addonReference ?? null).toLocaleString('vi-VN')}đ — đối chiếu hóa đơn với biểu phí dịch vụ bổ sung`;
      severity = 'config';
    } else if (dominant.key === 'residual') {
      verdict = `Lệch ${dominant.delta.toLocaleString('vi-VN')}đ không giải thích được bằng cấu trúc phí hiện tại`;
      severity = 'config';
    } else {
      switch (dominant.cause) {
        case 'THIEU_CAU_HINH_REMOTE':
          verdict = 'Hệ thống thiếu cấu hình vùng xa cho nước này — cần bổ sung';
          severity = 'config';
          break;
        case 'REMOTE_KHONG_KHOP':
          verdict = 'Phụ phí vùng xa không khớp hóa đơn';
          severity = 'config';
          break;
        case 'LECH_FUEL':
          verdict = 'Phụ phí xăng dầu (%) không khớp';
          severity = 'ratecard';
          break;
        case 'LECH_FUEL_BASE':
          verdict = 'Fuel đúng % nhưng tính trên cơ sở khác hóa đơn — một phụ phí (demand/ER…) nằm trong fuel base ở một bên; kiểm tra cờ fuelable hoặc bill bổ sung không kèm fuel';
          severity = 'ratecard';
          break;
        case 'LECH_RATE_CARD':
        case 'KHONG_KHOP':
        default:
          verdict = 'Bảng giá hệ thống khác hóa đơn — cần cập nhật rate card';
          severity = 'ratecard';
          break;
      }
    }
  }

  return { totalDelta, components, impliedWeight, impliedZone, verdict, severity };
}
