/** Pure mapping helpers cho import món tồn từ XLSX. Spec §6:
 *  docs/superpowers/specs/2026-06-11-warehouse-per-unit-design.md */

export function mapWarehouseCode(raw: string): string {
  const p = raw.split('|').map((s) => s.trim());
  return (p[1] || p[0] || '').toUpperCase();
}
export function mapStockStatus(r: { qc: string; action: string; exportDate: string }): string {
  if (/fail/i.test(r.qc)) return 'qc_failed';
  if (/tạm nhập/i.test(r.action)) return 'staging';
  const ed = (r.exportDate || '').trim();
  if (ed && ed !== 'Chưa xuất đơn') return 'shipped';
  return 'in_stock';
}
