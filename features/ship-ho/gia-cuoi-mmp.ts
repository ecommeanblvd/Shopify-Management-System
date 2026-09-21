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

export interface GiaCuoiVaDelta extends GiaCuoiMmp {
  previousChargedVnd: number | null;
  deltaVnd: number | null;
}

/**
 * THUẦN: giá cuối gửi MMP + `deltaVnd` KHỚP ĐÚNG con số vừa gửi.
 *
 * Hai bẫy đã dính (review 21/09):
 *   - Khi công tắc TẮT, `finalChargedVnd` = cước + duty nhưng delta lại tính trên cước
 *     ⇒ MMP nhận `previous + delta ≠ final`, lệch đúng bằng duty. Delta phải so trên
 *     CHÍNH `gia.finalChargedVnd`.
 *   - Re-quote lỗi (`cuocThucVnd` null) thì giá cuối lùi về GIÁ BÁO — mà giá báo chưa
 *     bao giờ gồm duty (spec §3.1) ⇒ KHÔNG được cộng duty lên nó.
 *
 * Trả null khi không có số nào để gửi (chưa có giá thực lẫn giá báo).
 */
export function giaCuoiVaDelta(
  i: { cuocThucVnd: number | null; giaBaoVnd: number | null; dutyVnd: number | null; shippedAt: string | null },
  bat: boolean = batTachDuty(),
): GiaCuoiVaDelta | null {
  const cuoc = i.cuocThucVnd ?? i.giaBaoVnd;
  if (cuoc == null) return null;
  const duty = i.cuocThucVnd == null ? 0 : i.dutyVnd;
  const gia = giaCuoiChoMmp({ cuocVnd: cuoc, dutyVnd: duty, shippedAt: i.shippedAt }, bat);
  return {
    ...gia,
    previousChargedVnd: i.giaBaoVnd,
    deltaVnd: i.giaBaoVnd == null ? null : gia.finalChargedVnd - i.giaBaoVnd,
  };
}
