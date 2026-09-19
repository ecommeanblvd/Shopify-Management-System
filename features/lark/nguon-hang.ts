/**
 * Nguồn trạng thái giao được coi là CỦA HÃNG (spec ghi ngược Lark §3.2). Chỉ những kiện này
 * mới được SMS ghi lên Lark, và ngược lại Lark không được đè lên chúng (chống vòng lặp).
 */
export const NGUON_HANG: readonly string[] = ['fedex', 'dhl', 'ups', 'trackingmore', 'carrier_bill'];

export function laNguonHang(source: string | null | undefined): boolean {
  return !!source && NGUON_HANG.includes(source);
}
