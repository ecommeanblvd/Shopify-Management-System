/** THUẦN: map delivery status (tracking provider) → webhook event trung tính. */
export function deliveryStatusToEvent(
  deliveryStatus: string,
): 'shipment.in_transit' | 'shipment.delivered' | 'shipment.exception' {
  const s = deliveryStatus.trim().toLowerCase();
  if (s === 'delivered') return 'shipment.delivered';
  if (/(exception|fail|return|undeliver|refus|lost|damage)/.test(s)) return 'shipment.exception';
  return 'shipment.in_transit';
}
