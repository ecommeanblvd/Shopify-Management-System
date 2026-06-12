/**
 * Decide what a re-imported LOG-Export row means for an existing
 * shipment_charge, given the previously-stored idempotency hash (if any)
 * and the freshly-computed one.
 *
 *   no prior charge        → 'new'      (insert)
 *   prior hash == new hash → 'unchanged'(skip — identical re-import)
 *   prior hash != new hash → 'updated'  (operator corrected the row →
 *                                         replace IN PLACE, one charge
 *                                         per shipment, no duplicate)
 *
 * Pure — drives both the dry-run preview and the real write so the two
 * always agree.
 */
export type ChargeDecision = 'new' | 'updated' | 'unchanged';

export function classifyCharge(prevHash: string | undefined | null, newHash: string): ChargeDecision {
  if (prevHash == null) return 'new';
  return prevHash === newHash ? 'unchanged' : 'updated';
}
