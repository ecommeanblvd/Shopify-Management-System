/** Khung fuel rộng 5% canh theo bội số 5; manual dùng MỐC GIỮA khung để giá ổn
 *  định trong khung (chỉ sinh lại khi fuel nhảy khung). vd 43% → khung [40,45] →
 *  mốc 42.5%. THUẦN. */
export function fuelBandMidpoint(percent: number): number {
  const lower = Math.floor(percent / 5) * 5;
  return lower + 2.5;
}
export function fuelBandLabel(percent: number): string {
  const lower = Math.floor(percent / 5) * 5;
  return `${lower}–${lower + 5}%`;
}
