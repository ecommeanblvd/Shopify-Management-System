import type { ReconcileViewRow } from '@/features/shipments/reconcile-view';

export interface IssueInfo {
  /** Short chip text for the status column, e.g. 'Sai zone', 'Lệch ER'. */
  label: string;
  /** Tailwind classes for the chip. */
  className: string;
  /** Stable key for grouping in the Logistics issues summary. */
  groupKey: string | null;
  /** Suggested follow-up for the Logistics summary (per group). */
  action: string | null;
}

const GREEN = 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
const RED = 'bg-red-500/10 text-red-600 dark:text-red-400';
const PURPLE = 'bg-purple-500/10 text-purple-600 dark:text-purple-400';
const AMBER = 'bg-amber-500/10 text-amber-600 dark:text-amber-400';
const ORANGE = 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
const MUTED = 'bg-muted text-muted-foreground';

/**
 * Condense a row's diagnosis into a short, specific issue chip + a group
 * for the Logistics to-check summary. Operator status (đã đối soát / bỏ
 * qua) is rendered separately by the caller — this only describes WHAT
 * is wrong with the money.
 */
export function issueInfo(r: ReconcileViewRow): IssueInfo {
  const d = r.diagnosis;
  if (r.engineTotal === null) {
    return {
      label: 'Không tính được',
      className: AMBER,
      groupKey: `noquote|${r.carrierKey}`,
      action: `Engine không quote được (${r.engineReason ?? 'không rõ'}) — kiểm tra rate card / dữ liệu đơn`,
    };
  }
  if (!d || d.severity === 'match' || d.severity === 'rounding') {
    return { label: 'Khớp', className: GREEN, groupKey: null, action: null };
  }
  if (d.severity === 'passthrough') {
    return { label: 'Khớp (ký nhận)', className: GREEN, groupKey: null, action: null };
  }
  const carrier = r.carrierKey.toUpperCase();
  switch (d.severity) {
    case 'weight':
      return {
        label: 'Sai cân',
        className: RED,
        groupKey: `weight|${r.carrierKey}`,
        action: `${carrier} tính bậc cân cao hơn cân hệ thống — đối chiếu cân/dim thực tế, khiếu nại ${carrier} nếu cân hệ thống đúng`,
      };
    case 'zone': {
      const iz = d.impliedZone;
      return {
        label: 'Sai zone',
        className: PURPLE,
        groupKey: `zone|${r.carrierKey}|${r.shipCountry}|${iz?.engineZoneLabel ?? ''}->${iz?.zoneLabel ?? ''}`,
        action: `${carrier} bill ${r.shipCountry} theo ${iz?.zoneLabel ?? '?'} nhưng hệ thống map ${iz?.engineZoneLabel ?? '?'} — confirm bảng zone với ${carrier}, nếu carrier đúng thì sửa zone mapping`,
      };
    }
    default: {
      // config / ratecard / discount — pick the dominant mismatching line.
      const actionable = d.components
        .filter((c) => c.cause !== 'KHOP' && c.cause !== 'PHAI_SINH' && c.cause !== 'PHAI_SINH_ZONE' && c.cause !== 'LAM_TRON')
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const dom = actionable[0];
      if (dom?.key === 'elevatedRisk') {
        const direction = dom.delta < 0 ? 'hệ thống tính, hóa đơn chưa thu' : 'hóa đơn thu, hệ thống không tính';
        if (r.carrierKey === 'fedex') {
          return {
            label: 'Lệch phí nhập',
            className: ORANGE,
            groupKey: `er|${r.carrierKey}|${dom.delta < 0 ? 'engine' : 'billed'}`,
            action: `Phí xử lý hàng nhập (US import handling) ${direction} — đối chiếu cột CK ops sheet / invoice phí nhập riêng của FedEx`,
          };
        }
        return {
          label: 'Lệch ER',
          className: ORANGE,
          groupKey: `er|${r.carrierKey}|${dom.delta < 0 ? 'engine' : 'billed'}`,
          action: `Phụ phí rủi ro (ER) ${direction} — đối chiếu bill bổ sung / danh sách nước ER của ${carrier}`,
        };
      }
      if (dom?.cause === 'THIEU_CAU_HINH_REMOTE' || dom?.cause === 'REMOTE_KHONG_KHOP') {
        return {
          label: 'Lệch remote',
          className: AMBER,
          groupKey: `remote|${r.carrierKey}`,
          action: `Phụ phí vùng xa không khớp — bổ sung postcode/city vào cấu hình remote của ${carrier}`,
        };
      }
      if (dom?.cause === 'LECH_FUEL_BASE') {
        return {
          label: 'Lệch fuel base',
          className: ORANGE,
          groupKey: `fuelbase|${r.carrierKey}`,
          action: `Fuel đúng % nhưng ${carrier} tính trên cơ sở khác (demand trong/ngoài fuel base) — đối chiếu cờ fuelable của phụ phí demand/ESS theo vùng`,
        };
      }
      if (dom?.cause === 'LECH_FUEL') {
        return {
          label: 'Lệch % fuel',
          className: ORANGE,
          groupKey: `fuel|${r.carrierKey}`,
          action: `% fuel hóa đơn khác % tuần trong hệ thống — đối chiếu lại fuel index ${carrier} theo tuần ship`,
        };
      }
      if (dom?.cause === 'LECH_RATE_CARD') {
        return {
          label: 'Lệch rate card',
          className: ORANGE,
          groupKey: `ratecard|${r.carrierKey}`,
          action: `Cước gốc không khớp bậc nào trên rate card — kiểm tra bảng giá ${carrier} còn hiệu lực`,
        };
      }
      return {
        label: 'Không khớp',
        className: MUTED,
        groupKey: `other|${r.carrierKey}`,
        action: `Cấu trúc phí không khớp hóa đơn ${carrier} — soi chi tiết từng dòng`,
      };
    }
  }
}
