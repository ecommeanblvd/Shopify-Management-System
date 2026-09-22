/**
 * Thời gian giao trung bình 30 ngày gần nhất của từng hãng — để Đức cân giữa GIÁ và TỐC ĐỘ
 * khi chọn line (CEO 22/09/2026). Ví dụ đi Saudi: FedEx 5,2 ngày còn Aramex 3,2 ngày.
 *
 * Tính từ kiện ĐÃ GIAO: delivered_at − label_created_at. Ưu tiên số liệu của ĐÚNG NƯỚC
 * đang gửi (thời gian khác nhau rất nhiều theo tuyến); ít kiện quá thì lùi về số liệu
 * chung mọi nước và nói rõ, để người đọc biết con số đáng tin tới đâu.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

export interface SoLieuThoiGian {
  /** Số ngày trung bình từ lúc tạo nhãn tới lúc giao. */
  ngayTb: number;
  soKien: number;
  /** 'nuoc' = số liệu của đúng nước đang gửi; 'chung' = gộp mọi nước. */
  phamVi: 'nuoc' | 'chung';
}

/** Dưới ngưỡng này thì một con số trung bình chỉ là ngẫu nhiên, không đáng tin. */
export const TOI_THIEU_KIEN = 5;

export interface DongThoiGian { carrierKey: string; soKien: number; ngayTb: number }

/**
 * THUẦN: ghép số liệu theo nước với số liệu chung → số liệu dùng cho từng hãng.
 * Đủ kiện theo nước thì lấy theo nước, không thì lùi về chung; không có gì thì bỏ hãng đó.
 */
export function chonSoLieu(
  theoNuoc: readonly DongThoiGian[],
  chung: readonly DongThoiGian[],
  toiThieu = TOI_THIEU_KIEN,
): Record<string, SoLieuThoiGian> {
  const out: Record<string, SoLieuThoiGian> = {};
  const mapChung = new Map(chung.map((d) => [d.carrierKey, d]));
  for (const d of theoNuoc) {
    if (d.soKien >= toiThieu) out[d.carrierKey] = { ngayTb: d.ngayTb, soKien: d.soKien, phamVi: 'nuoc' };
  }
  for (const d of mapChung.values()) {
    if (!out[d.carrierKey] && d.soKien > 0) out[d.carrierKey] = { ngayTb: d.ngayTb, soKien: d.soKien, phamVi: 'chung' };
  }
  return out;
}

const SQL_TRUNG_BINH = (ngay: number) => sql`
  s.delivered_at is not null
  and s.label_created_at is not null
  and s.delivered_at > s.label_created_at
  and s.carrier_key is not null
  and s.delivered_at >= now() - (${ngay} || ' days')::interval`;

/** Đọc số liệu 30 ngày cho một nước; trả theo từng hãng đã chọn phạm vi. */
export async function thoiGianGiaoTheoHang(country: string | null, soNgay = 30): Promise<Record<string, SoLieuThoiGian>> {
  const chungQ = db.execute(sql`
    select s.carrier_key, count(*)::int n,
      round(avg(extract(epoch from (s.delivered_at - s.label_created_at)) / 86400)::numeric, 1)::float8 ngay_tb
    from shipments s
    where ${SQL_TRUNG_BINH(soNgay)}
    group by 1`);
  const nuocQ = country
    ? db.execute(sql`
        select s.carrier_key, count(*)::int n,
          round(avg(extract(epoch from (s.delivered_at - s.label_created_at)) / 86400)::numeric, 1)::float8 ngay_tb
        from shipments s join shopify_orders o on o.id = s.order_id
        where ${SQL_TRUNG_BINH(soNgay)} and o.ship_country = ${country}
        group by 1`)
    : Promise.resolve({ rows: [] as unknown[] });

  const [chung, nuoc] = await Promise.all([chungQ, nuocQ]);
  const doc = (r: unknown): DongThoiGian[] =>
    ((r as { rows: Array<{ carrier_key: string; n: number; ngay_tb: number }> }).rows ?? [])
      .map((x) => ({ carrierKey: x.carrier_key, soKien: Number(x.n), ngayTb: Number(x.ngay_tb) }));
  return chonSoLieu(doc(nuoc), doc(chung));
}
