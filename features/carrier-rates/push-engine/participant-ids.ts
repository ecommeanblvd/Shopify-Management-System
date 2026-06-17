/**
 * Lọc id method-definition là CARRIER-CALCULATED participant (engine) để thay thế
 * khi re-push. Trong Shopify Admin GraphQL, rateProvider là union
 * `DeliveryRateProvider = DeliveryParticipant | DeliveryRateDefinition`:
 *   - `DeliveryParticipant`   → carrier-calculated (engine) ← CẦN xoá/thay
 *   - `DeliveryRateDefinition`→ flat manual rate          ← GIỮ NGUYÊN
 * Nhờ vậy re-push engine chỉ thay participant cũ, không đụng flat manual rate
 * ("Standard shipping"/"Express shipping").
 */
export function engineParticipantIdsToReplace(
  edges: Array<{ node: { id: string; rateProvider?: { __typename?: string } } }>,
): string[] {
  return edges
    .filter((m) => m.node.rateProvider?.__typename === 'DeliveryParticipant')
    .map((m) => m.node.id);
}
