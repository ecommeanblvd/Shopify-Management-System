/** Khớp dòng credit note (tracking → số NCC giảm) với các đơn đang đòi NCC. THUẦN. */
export interface CreditNoteLine { tracking: string; creditVnd: number }
export interface DisputingRow { shipmentId: string; tracking: string; claimedVnd: number; recoveredVnd: number }
export interface CreditMatchRow { shipmentId: string; tracking: string; creditVnd: number; newRecovered: number; fullyRecovered: boolean }
export interface CreditMatchResult { matched: CreditMatchRow[]; unmatched: { tracking: string; creditVnd: number; reason: string }[] }

export function matchCreditToDisputing(lines: CreditNoteLine[], disputing: DisputingRow[]): CreditMatchResult {
  const byTracking = new Map<string, DisputingRow>();
  for (const d of disputing) byTracking.set(d.tracking, d);
  const matched: CreditMatchRow[] = [];
  const unmatched: CreditMatchResult['unmatched'] = [];
  for (const ln of lines) {
    const d = byTracking.get(ln.tracking);
    if (!d) { unmatched.push({ tracking: ln.tracking, creditVnd: ln.creditVnd, reason: 'Không phải đơn đang đòi NCC' }); continue; }
    const newRecovered = d.recoveredVnd + ln.creditVnd;
    matched.push({ shipmentId: d.shipmentId, tracking: d.tracking, creditVnd: ln.creditVnd, newRecovered, fullyRecovered: newRecovered >= d.claimedVnd });
  }
  return { matched, unmatched };
}
