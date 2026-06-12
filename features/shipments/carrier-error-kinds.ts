/** Phân loại lỗi carrier (FedEx/DHL tính sai) cho nút "Duyệt" — dùng chung
 *  UI dropdown + validate server. Cố định, nhỏ. */
export const CARRIER_ERROR_KINDS = [
  { value: 'weight', label: 'Sai cân' },
  { value: 'zone', label: 'Sai zone' },
  { value: 'surcharge', label: 'Phụ phí sai (demand/ký nhận/remote)' },
  { value: 'fuel', label: 'Lệch % fuel' },
  { value: 'ratecard', label: 'Sai rate card / chiết khấu' },
  { value: 'other', label: 'Khác' },
] as const;

export type CarrierErrorKind = (typeof CARRIER_ERROR_KINDS)[number]['value'];

export function isCarrierErrorKind(v: string): v is CarrierErrorKind {
  return CARRIER_ERROR_KINDS.some((k) => k.value === v);
}

export function carrierErrorKindLabel(v: string): string {
  return CARRIER_ERROR_KINDS.find((k) => k.value === v)?.label ?? v;
}
