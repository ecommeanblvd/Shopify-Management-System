import type { ReconcileDiagnosis, DiagnosisSeverity, ComponentDelta } from './reconcile-diagnose';

function kindOfComponent(c: ComponentDelta): string {
  switch (c.key) {
    case 'base':
      if (c.cause === 'SAI_CAN') return 'weight';
      if (c.cause === 'SAI_ZONE') return 'zone';
      return 'ratecard';
    case 'discount': return 'ratecard';
    case 'fuel': return 'fuel';
    case 'remote': return 'remote';
    case 'demand': return 'demand';
    case 'signature': return 'signature';
    case 'vat': return 'vat';
    default: return 'other';
  }
}

/** Gợi ý loại lỗi từ khoản lệch |delta| lớn nhất khác KHOP. '' nếu không rõ. */
export function suggestCauseKind(diagnosis: ReconcileDiagnosis | null | undefined): string {
  if (!diagnosis) return '';
  let best: ComponentDelta | null = null;
  for (const c of diagnosis.components) {
    if (c.cause === 'KHOP' || c.delta === 0) continue;
    if (best === null || Math.abs(c.delta) > Math.abs(best.delta)) best = c;
  }
  return best ? kindOfComponent(best) : '';
}

/** billed > engine ⇒ NCC thu vượt ⇒ phải đòi. */
export function needsCarrierClaim(deltaVnd: number | null): boolean {
  return deltaVnd != null && deltaVnd > 0;
}

/** Đơn đang đòi chỉ DUYỆT khi bill mới đã khớp. */
export function isApprovableMatch(severity: DiagnosisSeverity | null | undefined): boolean {
  return severity === 'match' || severity === 'rounding';
}
