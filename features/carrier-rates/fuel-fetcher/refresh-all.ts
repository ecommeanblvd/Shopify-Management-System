/**
 * Bộ chạy DÙNG CHUNG cho tác vụ `refresh-fuel`.
 * ============================================================================
 *
 * Vì sao có file này (sự cố 23/09/2026):
 * Tác vụ `refresh-fuel` có HAI đường vào — script cron
 * `scripts/cron/refresh-fedex-fuel.ts` và route HTTP
 * `app/api/cron/refresh-fuel/route.ts` (đường THẬT đang chạy hằng ngày, do
 * GitHub Actions `.github/workflows/refresh-fuel.yml` gọi). Mỗi đường tự viết
 * lại câu truy vấn "lấy hãng nào" của riêng mình:
 *
 *   script : ['fedex', 'dhl', 'ups', 'sf-express']   ← cập nhật 06/07/2026
 *   route  : ['fedex', 'dhl']                        ← đứng im từ 02/06/2026
 *
 * Hậu quả: UPS và SF Express KHÔNG BAO GIỜ được gọi qua đường đang chạy. Không
 * có lỗi nào để mà thấy — hai hãng chỉ đơn giản là không nằm trong vòng lặp. Mức
 * xăng dầu UPS đứng im ở 39,00% từ 06/07 tới 23/09 (11 tuần) trong khi giá thật
 * đã lên 52,50%, tức MỌI báo giá UPS thiếu 13,5 điểm phần trăm xăng dầu.
 *
 * Nên: chỉ còn MỘT chỗ duy nhất quyết định "quét hãng nào và coi là hỏng khi
 * nào". Hai đường vào chỉ còn là vỏ bọc ghi nhật ký.
 *
 * Hai lớp canh, cả hai đều làm lượt chạy ĐỎ và GỌI TÊN hãng:
 *   1. Hãng fetch lỗi (404, đổi markup, parse hỏng) → `hong`.
 *   2. Hãng fetch "thành công" nhưng tuần mới nhất đang lưu vẫn quá cũ →
 *      `quaHan`. Đây là lớp bắt được ca nguồn dữ liệu tự nó chết (trang CHN của
 *      SF Express không đăng tuần mới nào từ 29/06/2026): fetch trả 200, parse
 *      ra 15 tuần, 0 thay đổi — xanh lè mà giá vẫn lạc hậu.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refreshCarrierFuel } from './apply';
import {
  AUTO_FUEL_CARRIER_KEYS,
  findStaleAutoFuel,
  type AutoFuelRow,
} from './manual-fuel-staleness';

/** Ngưỡng coi là quá hạn. Xăng dầu công bố theo TUẦN → 14 ngày là 2 kỳ liền
 *  không có gì mới, chắc chắn hỏng chứ không phải trễ nhịp. */
export const NGUONG_QUA_HAN_NGAY = 14;

export interface KetQuaHang {
  accountId: string;
  accountName: string;
  carrierKey: string;
  previousPercent: number | null;
  newPercent: number | null;
  changed: boolean;
  error?: string;
}

export interface KetQuaRefreshFuel {
  tong: number;
  thanhCong: number;
  /** Mô tả từng hãng hỏng, đã gọi tên hãng. */
  hong: string[];
  /** Mô tả từng hãng tuy chạy xong nhưng giá vẫn quá cũ. */
  quaHan: string[];
  ketQua: KetQuaHang[];
}

/**
 * Quét mọi tài khoản đang bật của các hãng trong `AUTO_FUEL_CARRIER_KEYS`.
 * Một hãng hỏng KHÔNG chặn các hãng còn lại — chạy hết rồi mới tổng kết.
 */
export async function chayRefreshFuel(args: {
  triggeredBy?: string | null;
  now?: Date;
  nguongQuaHanNgay?: number;
} = {}): Promise<KetQuaRefreshFuel> {
  const now = args.now ?? new Date();
  const accounts = await db
    .select({
      id: schema.carrierAccounts.id,
      name: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(
      and(
        inArray(schema.carriers.key, [...AUTO_FUEL_CARRIER_KEYS]),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );

  const ketQua: KetQuaHang[] = [];
  const hong: string[] = [];

  for (const account of accounts) {
    const nhan = `[${account.carrierKey ?? '?'}] ${account.name}`;
    try {
      const applied = await refreshCarrierFuel({
        carrierAccountId: account.id,
        triggeredBy: args.triggeredBy ?? null,
      });
      ketQua.push({
        accountId: account.id,
        accountName: account.name,
        carrierKey: applied.carrierKey,
        previousPercent: applied.previousPercent,
        newPercent: applied.newPercent,
        changed: applied.changed,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      hong.push(`${nhan}: ${msg}`);
      ketQua.push({
        accountId: account.id,
        accountName: account.name,
        carrierKey: account.carrierKey ?? 'unknown',
        previousPercent: null,
        newPercent: null,
        changed: false,
        error: msg,
      });
    }
  }

  const quaHan = await timHangQuaHan(
    accounts.map((a) => ({ id: a.id, name: a.name, carrierKey: a.carrierKey })),
    now,
    args.nguongQuaHanNgay ?? NGUONG_QUA_HAN_NGAY,
  );

  return {
    tong: accounts.length,
    thanhCong: ketQua.filter((r) => !r.error).length,
    hong,
    quaHan,
    ketQua,
  };
}

/** Đọc tuần mới nhất đang lưu của từng tài khoản rồi lọc qua `findStaleAutoFuel`. */
async function timHangQuaHan(
  accounts: { id: string; name: string; carrierKey: string | null }[],
  now: Date,
  nguongNgay: number,
): Promise<string[]> {
  const rows: AutoFuelRow[] = [];
  for (const a of accounts) {
    const [moiNhat] = await db
      .select({ startsAt: schema.carrierSurcharges.startsAt })
      .from(schema.carrierSurcharges)
      .where(
        and(
          eq(schema.carrierSurcharges.carrierAccountId, a.id),
          eq(schema.carrierSurcharges.kind, 'fuel_percent'),
          eq(schema.carrierSurcharges.active, true),
        ),
      )
      .orderBy(desc(schema.carrierSurcharges.startsAt))
      .limit(1);
    rows.push({
      accountId: a.id,
      accountName: a.name,
      carrierKey: a.carrierKey ?? 'unknown',
      newestWeekStart: moiNhat?.startsAt ?? null,
    });
  }
  return findStaleAutoFuel(rows, now, nguongNgay).map((s) =>
    s.reason === 'unset'
      ? `[${s.carrierKey}] ${s.accountName}: chưa có dòng fuel_percent nào`
      : `[${s.carrierKey}] ${s.accountName}: tuần mới nhất đã ${s.daysSince} ngày tuổi`,
  );
}

/**
 * THUẦN: biến kết quả thành câu lý do cho `kiemTra` của `chayCron`/`chayJobApi`.
 * Trả về null khi mọi hãng đều ổn; ngược lại trả câu CÓ GỌI TÊN hãng để người
 * đọc trang giám sát biết ngay phải đi sửa hãng nào.
 */
export function loiRefreshFuel(kq: KetQuaRefreshFuel): string | null {
  const phan: string[] = [];
  if (kq.hong.length > 0) phan.push(`${kq.hong.length}/${kq.tong} hãng lỗi — ${kq.hong.join(' | ')}`);
  if (kq.quaHan.length > 0) phan.push(`${kq.quaHan.length} hãng giá quá hạn — ${kq.quaHan.join(' | ')}`);
  return phan.length > 0 ? phan.join(' ; ') : null;
}
