/**
 * Đối chiếu lý do giao chậm với FedEx / UPS và ghi kết quả (CEO 16/09/2026). Dùng chung cho cron và
 * cho lúc người dùng vừa gán lý do (đối chiếu ngay để thấy kết quả). Không kiểm quyền.
 *
 * Luật hiệu lực: lý do chỉ rút kiện khỏi mẫu số KPI khi `ly_do_doi_chieu = 'xac_nhan'`
 * (`lyDoCoHieuLuc`). Không kiểm được — hãng khác FedEx, quá 90 ngày, mã vận đơn FedEx báo sai —
 * thì KHÔNG được loại: không có bằng chứng thì kiện vẫn tính.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { layLichSuQuet, TOI_DA_MOI_LO, CUA_SO_TRACK_NGAY } from '@/lib/fedex/track';
import { layLichSuQuetUps } from '@/lib/ups/track';
import { doiChieuFedex, coLuatDoiChieu, type DoiChieu } from './doi-chieu-fedex';
import { doiChieuUps } from './doi-chieu-ups';
import { LY_DO_CHAM } from './ly-do-cham';

type Nguon = 'shopify' | 'ship_ho';
interface Viec { nguon: Nguon; id: string; lyDo: string; hang: string | null; tk: string | null; ngayGui: string | null }

export interface KetQuaDoiChieuLo {
  daKiem: number; xacNhan: number; khongThay: number; khongKiemDuoc: number;
  /** Lô FedEx lỗi mạng / hết hạn token — để nguyên, lượt sau thử lại. */
  loi: number; loiMau?: string;
}

/** Lỗi phía FedEx có thể tự hết — không được ghi thành kết luận. */
export const laLoiTamThoi = (ma: string): boolean => /INTERNAL|SERVICE|UNAVAILABLE|TIMEOUT|RATE|THROTTL/i.test(ma);

const LY_DO_LOAI_TRU = LY_DO_CHAM.filter((l) => l.loaiTruKpi && coLuatDoiChieu(l.ma)).map((l) => l.ma);

async function ghi(v: Viec, dc: DoiChieu): Promise<void> {
  const bangChung = [dc.bangChung, dc.canhBao ? `⚠ ${dc.canhBao}` : null].filter(Boolean).join(' — ') || null;
  if (v.nguon === 'shopify') {
    await db.execute(sql`UPDATE shipments SET ly_do_doi_chieu = ${dc.ketQua}, ly_do_bang_chung = ${bangChung}, ly_do_doi_chieu_at = now()
      WHERE id = ${v.id} AND ly_do_cham = ${v.lyDo}`);
  } else {
    await db.execute(sql`UPDATE ship_ho_orders SET ly_do_doi_chieu = ${dc.ketQua}, ly_do_bang_chung = ${bangChung}, ly_do_doi_chieu_at = now()
      WHERE id = ${v.id} AND ly_do_cham = ${v.lyDo}`);
  }
}

/**
 * Đối chiếu các kiện đang chờ. `chi` = chỉ đúng một kiện (vừa gán lý do).
 * Kiện 'khong_thay' được kiểm lại sau mỗi ngày trong cửa sổ 90 ngày — hàng đang đi thì sự kiện
 * của hãng có thể tới sau khi người ta gán lý do.
 */
export async function doiChieuLyDoCham(opts: { limit?: number; chi?: { nguon: Nguon; id: string } } = {}): Promise<KetQuaDoiChieuLo> {
  const limit = opts.limit ?? 300;
  const kq: KetQuaDoiChieuLo = { daKiem: 0, xacNhan: 0, khongThay: 0, khongKiemDuoc: 0, loi: 0 };
  if (LY_DO_LOAI_TRU.length === 0) return kq;
  const choKiem = sql`(ly_do_doi_chieu IS NULL
      OR (ly_do_doi_chieu = 'khong_thay' AND ly_do_doi_chieu_at < now() - interval '1 day'))`;
  const { rows } = await db.execute<{ nguon: Nguon; id: string; ly_do: string; hang: string | null; tk: string | null; ngay: string | null }>(sql`
    SELECT * FROM (
      SELECT 'shopify'::text AS nguon, id, ly_do_cham AS ly_do, carrier_key AS hang, tracking_number AS tk, label_created_at::text AS ngay
        FROM shipments
       WHERE ly_do_cham IN ${LY_DO_LOAI_TRU} AND ${choKiem}
         ${opts.chi?.nguon === 'shopify' ? sql`AND id = ${opts.chi.id}` : opts.chi ? sql`AND false` : sql``}
      UNION ALL
      SELECT 'ship_ho'::text, id, ly_do_cham, carrier_key, tracking_number, shipped_at::text
        FROM ship_ho_orders
       WHERE ly_do_cham IN ${LY_DO_LOAI_TRU} AND ${choKiem}
         ${opts.chi?.nguon === 'ship_ho' ? sql`AND id = ${opts.chi.id}` : opts.chi ? sql`AND false` : sql``}
    ) x ORDER BY ngay DESC NULLS LAST LIMIT ${limit}`);

  const hanCuoi = Date.now() - CUA_SO_TRACK_NGAY * 86_400_000;
  const fedex: Viec[] = [];
  for (const r of rows) {
    const v: Viec = { nguon: r.nguon, id: r.id, lyDo: r.ly_do, hang: r.hang, tk: r.tk?.trim() || null, ngayGui: r.ngay };
    if (v.hang === 'ups' && v.tk) {
      // UPS tra từng mã một. Lỗi mạng / thiếu key → để nguyên, lượt sau thử lại.
      let ls: Awaited<ReturnType<typeof layLichSuQuetUps>>;
      try { ls = await layLichSuQuetUps(v.tk); }
      catch (e) { kq.loi++; kq.loiMau ??= String((e as Error).message ?? e).slice(0, 200); continue; }
      const dc: DoiChieu = 'loi' in ls
        ? { ketQua: 'khong_kiem_duoc', bangChung: `UPS không nhận mã vận đơn (${ls.loi})` }
        : doiChieuUps(v.lyDo, ls.suKien);
      await ghi(v, dc);
      kq.daKiem++;
      if (dc.ketQua === 'xac_nhan') kq.xacNhan++;
      else if (dc.ketQua === 'khong_thay') kq.khongThay++;
      else kq.khongKiemDuoc++;
      continue;
    }
    if (v.hang !== 'fedex' || !v.tk) {
      await ghi(v, { ketQua: 'khong_kiem_duoc', bangChung: v.tk ? `Chưa có nguồn đối chiếu cho hãng ${v.hang ?? '?'}` : 'Kiện chưa có mã vận đơn' });
      kq.daKiem++; kq.khongKiemDuoc++; continue;
    }
    if (v.ngayGui && new Date(v.ngayGui).getTime() < hanCuoi) {
      await ghi(v, { ketQua: 'khong_kiem_duoc', bangChung: `FedEx chỉ giữ lịch sử quét ${CUA_SO_TRACK_NGAY} ngày` });
      kq.daKiem++; kq.khongKiemDuoc++; continue;
    }
    fedex.push(v);
  }

  for (let i = 0; i < fedex.length; i += TOI_DA_MOI_LO) {
    const lo = fedex.slice(i, i + TOI_DA_MOI_LO);
    let ls: Awaited<ReturnType<typeof layLichSuQuet>>;
    try { ls = await layLichSuQuet(lo.map((v) => v.tk!)); }
    catch (e) { kq.loi += lo.length; kq.loiMau ??= String((e as Error).message ?? e).slice(0, 200); continue; }
    for (const v of lo) {
      const r = ls.get(v.tk!);
      // Mã không có trong phản hồi, hoặc FedEx lỗi TẠM THỜI cho riêng mã này: để nguyên, lượt sau
      // thử lại. Chỉ lỗi "mã không tồn tại / sai" mới là kết luận không kiểm được.
      if (!r || ('loi' in r && laLoiTamThoi(r.loi))) { kq.loi++; kq.loiMau ??= r && 'loi' in r ? r.loi : 'thiếu trong phản hồi'; continue; }
      const dc: DoiChieu = 'loi' in r
        ? { ketQua: 'khong_kiem_duoc', bangChung: `FedEx không nhận mã vận đơn (${r.loi})` }
        : doiChieuFedex(v.lyDo, r.suKien);
      await ghi(v, dc);
      kq.daKiem++;
      if (dc.ketQua === 'xac_nhan') kq.xacNhan++;
      else if (dc.ketQua === 'khong_thay') kq.khongThay++;
      else kq.khongKiemDuoc++;
    }
  }
  return kq;
}
