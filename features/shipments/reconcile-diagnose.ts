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
  | 'PHAI_SINH'
  | 'KHONG_KHOP'
  | 'LAM_TRON';

export type DiagnosisSeverity =
  | 'match' | 'weight' | 'zone' | 'config' | 'ratecard' | 'discount' | 'rounding';

export type ComponentKey =
  | 'base' | 'discount' | 'fuel' | 'remote' | 'demand'
  | 'signature' | 'vat' | 'gogreen' | 'elevatedRisk' | 'residual';

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
     * DHL models the per-shipment signature fee as a `peak_fixed` surcharge
     * (FedEx has none — always 0). Folded into the signature line so it
     * reconciles against the billed `directSignature`.
     */
    peak?: number;
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
}

const r = (n: number): number => Math.round(n);
const n0 = (v: number | null): number => (v == null ? 0 : v);

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
  if (tier.upperKg <= engineTierUpperKg) {
    // Matched a tier but not heavier — treat the price gap as a card mismatch.
    return { cause: 'LECH_RATE_CARD', implied: null };
  }
  const prevUpper = idx > 0 ? zoneRates[idx - 1].upperKg : 0;
  const engineIdx = zoneRates.findIndex((z) => z.upperKg === engineTierUpperKg);
  const deltaTiers = engineIdx >= 0 ? idx - engineIdx : 1;
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
    const candidates = [
      c0,
      c0 + n0(b.demand),
      c0 + n0(b.signature),
      c0 + n0(b.demand) + n0(b.signature),
    ];
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
      fuelCause = upstreamFlagged
        ? (impliedZone ? 'PHAI_SINH_ZONE' : 'PHAI_SINH')
        : 'LECH_FUEL_BASE';
    }
  }
  components.push({ key: 'fuel', billed: fuelBilled, engine: e.fuel, delta: fuelDelta, cause: fuelCause });

  // demand
  const demBilled = n0(b.demand);
  const demDelta = r(demBilled - e.demand);
  components.push({ key: 'demand', billed: demBilled, engine: e.demand, delta: demDelta, cause: demDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // signature — engine side = residential_fixed + peak_fixed. DHL books the
  // per-shipment signature fee under `peak_fixed`; FedEx books residential
  // delivery under `residential_fixed`. Neither carrier uses both, so summing
  // them onto one line reconciles each against the billed `directSignature`
  // without a separate billed counterpart for residential.
  const sigBilled = n0(b.signature);
  const sigEngine = r(e.residential + n0(e.peak ?? null));
  const sigDelta = r(sigBilled - sigEngine);
  components.push({ key: 'signature', billed: sigBilled, engine: sigEngine, delta: sigDelta, cause: sigDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // vat
  const vatBilled = n0(b.vat);
  const vatDelta = r(vatBilled - e.vat);
  let vatCause: DiagnosisCause = 'KHOP';
  if (vatDelta !== 0) {
    // VAT is derived from the post-discount subtotal — treat as downstream.
    // Under a zone mismatch, verify it against the BILLED pre-VAT sum: if
    // it reproduces exactly, it is pure fallout of the zone difference.
    vatCause = 'PHAI_SINH';
    if (impliedZone && input.vatPercent > 0) {
      const billedPreVat = billedNetBase + n0(b.remote) + n0(b.demand) + n0(b.signature)
        + n0(b.gogreen) + n0(b.elevatedRisk) + fuelBilled;
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
  const erBilled = r(n0(b.elevatedRisk) + n0(b.importHandling ?? null));
  const erEngine = r(n0(e.countryFixed ?? null));
  const erDelta = r(erBilled - erEngine);
  components.push({ key: 'elevatedRisk', billed: erBilled, engine: erEngine, delta: erDelta, cause: erDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

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
    verdict = `Carrier tính ở mức cân cao hơn: ${lo}–${hi} kg (bậc ≤ ${hi} kg) vs hệ thống ${impliedWeight.engineChargeableKg} kg`;
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
        && c.cause !== 'PHAI_SINH_ZONE' && c.cause !== 'LAM_TRON')
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const dominant = actionable[0];
    if (!dominant) {
      verdict = `Chỉ lệch do làm tròn (${residual}đ)`;
      severity = 'rounding';
    } else if (dominant.key === 'elevatedRisk') {
      verdict = dominant.delta < 0
        ? 'Hệ thống tính phụ phí rủi ro (ER) nhưng hóa đơn không thu — kiểm tra ngày hiệu lực / danh sách nước'
        : 'Hóa đơn thu phụ phí rủi ro (ER) nhưng hệ thống không tính — kiểm tra danh sách nước áp dụng';
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
