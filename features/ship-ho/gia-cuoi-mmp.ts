/**
 * THUẦN: dựng phần giá trong `order.reconciled` gửi MMP theo công tắc MMP_TACH_DUTY.
 *
 * Cột DB đã tách cước/duty từ 21/09/2026, nhưng MMP đổi hợp đồng theo ngày hẹn: trước ngày
 * đó `finalChargedVnd` vẫn phải = cước + duty (nghĩa cũ), không thì kỳ 07/08 MMP đã khoá
 * lệch. Bật `1` → cước riêng, kèm `dutyVnd`; sự kiện KHÔNG có `dutyVnd` là bản cũ.
 */
export const batTachDuty = (env: string | undefined = process.env.MMP_TACH_DUTY): boolean => env === '1';

export interface GiaCuoiMmp {
  finalChargedVnd: number;
  dutyVnd?: number;
  totalWithDutyVnd?: number;
  /** Mốc xếp kỳ cước phía MMP (spec §2.1). */
  shippedAt: string | null;
}

export function giaCuoiChoMmp(
  i: { cuocVnd: number; dutyVnd: number | null; shippedAt: string | null },
  bat: boolean = batTachDuty(),
): GiaCuoiMmp {
  const duty = Math.round(i.dutyVnd ?? 0);
  const cuoc = Math.round(i.cuocVnd);
  if (!bat) return { finalChargedVnd: cuoc + duty, shippedAt: i.shippedAt };
  return { finalChargedVnd: cuoc, dutyVnd: duty, totalWithDutyVnd: cuoc + duty, shippedAt: i.shippedAt };
}
