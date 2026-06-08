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
  | 'PHAI_SINH'
  | 'KHONG_KHOP'
  | 'LAM_TRON';

export type DiagnosisSeverity =
  | 'match' | 'weight' | 'config' | 'ratecard' | 'discount' | 'rounding';

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

export interface ReconcileDiagnosis {
  totalDelta: number;
  components: ComponentDelta[];
  impliedWeight: ImpliedWeight | null;
  verdict: string;
  severity: DiagnosisSeverity;
}

export interface DiagnoseInput {
  billed: {
    base: number | null; discount: number | null; fuel: number | null;
    remote: number | null; demand: number | null; signature: number | null;
    vat: number | null; gogreen: number | null; elevatedRisk: number | null;
    total: number;
  };
  engine: {
    base: number; discount: number; fuel: number; remote: number;
    demand: number; residential: number; vat: number; total: number;
  };
  engineChargeableWeightKg: number;
  engineTierUpperKg: number;
  /** Package-appropriate gross list rate ladder, ascending by upperKg. */
  zoneRates: Array<{ upperKg: number; rate: number }>;
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

export function diagnoseReconcileRow(input: DiagnoseInput): ReconcileDiagnosis {
  const b = input.billed;
  const e = input.engine;
  const totalDelta = r(b.total - e.total);

  const components: ComponentDelta[] = [];
  let impliedWeight: ImpliedWeight | null = null;

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

  // fuel
  const fuelBilled = n0(b.fuel);
  const fuelDelta = r(fuelBilled - e.fuel);
  let fuelCause: DiagnosisCause = 'KHOP';
  if (fuelDelta !== 0) {
    const impliedPct = input.billedFuelableBase > 0 ? (fuelBilled / input.billedFuelableBase) * 100 : null;
    const pctMatches = impliedPct != null && Math.abs(impliedPct - input.fuelPercent) < 0.05;
    fuelCause = pctMatches ? 'PHAI_SINH' : 'LECH_FUEL';
  }
  components.push({ key: 'fuel', billed: fuelBilled, engine: e.fuel, delta: fuelDelta, cause: fuelCause });

  // demand
  const demBilled = n0(b.demand);
  const demDelta = r(demBilled - e.demand);
  components.push({ key: 'demand', billed: demBilled, engine: e.demand, delta: demDelta, cause: demDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // signature  (engine side = residential)
  const sigBilled = n0(b.signature);
  const sigDelta = r(sigBilled - e.residential);
  components.push({ key: 'signature', billed: sigBilled, engine: e.residential, delta: sigDelta, cause: sigDelta === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // vat
  const vatBilled = n0(b.vat);
  const vatDelta = r(vatBilled - e.vat);
  let vatCause: DiagnosisCause = 'KHOP';
  if (vatDelta !== 0) {
    // VAT is derived from the post-discount subtotal — treat as downstream.
    vatCause = 'PHAI_SINH';
  }
  components.push({ key: 'vat', billed: vatBilled, engine: e.vat, delta: vatDelta, cause: vatCause });

  // gogreen (engine has no gogreen line -> engine 0)
  const ggBilled = n0(b.gogreen);
  components.push({ key: 'gogreen', billed: ggBilled, engine: 0, delta: r(ggBilled), cause: ggBilled === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // elevatedRisk (engine has no line -> engine 0)
  const erBilled = n0(b.elevatedRisk);
  components.push({ key: 'elevatedRisk', billed: erBilled, engine: 0, delta: r(erBilled), cause: erBilled === 0 ? 'KHOP' : 'KHONG_KHOP' });

  // residual = whatever is left so the identity holds exactly.
  const explained = components.reduce((a, c) => a + c.delta, 0);
  const residual = r(totalDelta - explained);
  components.push({ key: 'residual', billed: 0, engine: 0, delta: residual, cause: residual === 0 ? 'KHOP' : 'LAM_TRON' });

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
  } else {
    // PHAI_SINH (downstream of base) and KHOP never headline.
    const actionable = components
      .filter((c) => c.key !== 'residual' && c.cause !== 'KHOP' && c.cause !== 'PHAI_SINH')
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const dominant = actionable[0];
    if (!dominant) {
      verdict = `Chỉ lệch do làm tròn (${residual}đ)`;
      severity = 'rounding';
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
        case 'LECH_RATE_CARD':
        case 'KHONG_KHOP':
        default:
          verdict = 'Bảng giá hệ thống khác hóa đơn — cần cập nhật rate card';
          severity = 'ratecard';
          break;
      }
    }
  }

  return { totalDelta, components, impliedWeight, verdict, severity };
}
