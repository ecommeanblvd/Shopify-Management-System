/**
 * THUẦN: danh sách bộ phận dùng CHUNG cho mọi module.
 *
 * Trước đây nằm trong `features/cx-ticket/phan-loai.ts` vì chỉ module ticket
 * dùng. Module sự cố (28/09) cũng cần quy thiệt hại về bộ phận, nên chuyển ra
 * đây — `cx-ticket` export lại để không file nào khác phải sửa.
 *
 * Giữ nguyên mã của Lark (`CX-CS`, `DISCO-WH`…) để đối chiếu ngược không phải
 * dịch. Hai bảng Lark lại gọi tên khác nhau cho cùng bộ phận (`Warehouse` ở bảng
 * sự cố vs `DISCO-WH` ở bảng ticket), nên từng script nhập tự dịch về đây.
 */

export const BO_PHAN = [
  { ma: 'CX-CS', ten: 'CX - Chăm sóc khách' },
  { ma: 'MERCHANDISE', ten: 'Merchandise' },
  { ma: 'PROCUREMENT', ten: 'Procurement' },
  { ma: 'DISCO-WH', ten: 'Kho' },
  { ma: 'DISCO-LOG', ten: 'Logistics' },
  { ma: 'CHINA', ten: 'BD China' },
  /* Chỉ bảng sự cố có bộ phận này (1 ca, $275,77); bảng ticket của Lark không
   * khai nó. Danh sách bên mình là HỢP của cả hai. */
  { ma: 'PRODUCT-PORTFOLIO', ten: 'Product Portfolio' },
] as const;

export type MaBoPhan = (typeof BO_PHAN)[number]['ma'];

const BO_PHAN_MA = new Set<string>(BO_PHAN.map((b) => b.ma));

export function boPhanHopLe(ma: string): boolean {
  return BO_PHAN_MA.has(ma);
}

export function nhanBoPhan(ma: string | null): string {
  if (!ma) return '—';
  return BO_PHAN.find((b) => b.ma === ma)?.ten ?? ma;
}
