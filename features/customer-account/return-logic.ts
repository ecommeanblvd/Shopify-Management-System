/** THUẦN: chặn tạo trùng return đang mở cùng 1 đơn. */
export function canCreateReturn(
  existing: Array<{ orderId: string; status: string }>,
  orderId: string,
): { ok: true } | { ok: false; reason: 'duplicate' } {
  const open = existing.some((r) => r.orderId === orderId && r.status === 'requested');
  return open ? { ok: false, reason: 'duplicate' } : { ok: true };
}
