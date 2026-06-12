/** Loại lỗi carrier theo từng khoản + biện pháp gợi ý. Dùng chung UI + validate. */
export const CARRIER_ERROR_KINDS = [
  { value: 'weight',    label: 'Sai cân',                       remediation: 'Đối chiếu cân thực/dim; nếu NCC cân sai → yêu cầu cân lại & điều chỉnh bill.' },
  { value: 'zone',      label: 'Sai zone',                      remediation: 'Đối chiếu zone trên rate card NCC; nếu NCC sai → đòi sửa zone & gửi bill mới.' },
  { value: 'fuel',      label: 'Sai phụ phí xăng dầu (fuel)',   remediation: 'Đối chiếu % fuel tuần label; nếu NCC áp sai → đòi điều chỉnh.' },
  { value: 'remote',    label: 'Sai phụ phí vùng xa (remote)',  remediation: 'Kiểm ODA/postcode; nếu NCC tính remote sai → đòi gỡ/điều chỉnh.' },
  { value: 'demand',    label: 'Sai phụ phí nhu cầu (demand)',  remediation: 'Đối chiếu biểu demand theo ngày; nếu sai mốc → đòi điều chỉnh.' },
  { value: 'signature', label: 'Sai phụ phí ký nhận',           remediation: 'Xác nhận có yêu cầu ký nhận không; nếu NCC thu nhầm → đòi gỡ.' },
  { value: 'vat',       label: 'Sai VAT',                       remediation: 'Kiểm VAT 8% trên đúng cơ sở; nếu NCC tính sai gốc → đòi tính lại.' },
  { value: 'ratecard',  label: 'Sai rate card / chiết khấu',    remediation: 'Đối chiếu rate/chiết khấu hợp đồng; nếu NCC áp sai → đòi áp đúng.' },
  { value: 'other',     label: 'Khác',                          remediation: 'Ghi rõ ở ô lý do; làm việc trực tiếp với NCC.' },
] as const;

export type CarrierErrorKind = (typeof CARRIER_ERROR_KINDS)[number]['value'];

/** Loại cũ đã ngừng chọn nhưng còn dữ liệu — vẫn hiển thị đẹp. */
const LEGACY_LABELS: Record<string, string> = { surcharge: 'Phụ phí sai' };

export function isCarrierErrorKind(v: string): v is CarrierErrorKind {
  return CARRIER_ERROR_KINDS.some((k) => k.value === v);
}
export function carrierErrorKindLabel(v: string): string {
  return CARRIER_ERROR_KINDS.find((k) => k.value === v)?.label ?? LEGACY_LABELS[v] ?? v;
}
export function carrierErrorKindRemediation(v: string): string {
  return CARRIER_ERROR_KINDS.find((k) => k.value === v)?.remediation ?? '';
}
