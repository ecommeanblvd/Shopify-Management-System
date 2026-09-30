/**
 * Kiểm cước net FedEx trên bill có bằng đúng một ô trong BẢNG GIÁ CỐ ĐỊNH không.
 * CEO chốt 08/09: bảng giá hợp đồng carrier cố định suốt hợp tác (chỉ xăng dầu và
 * phụ phí từng lô đổi), nên cước net trên bill PHẢI trùng một ô (mốc cân × loại gói)
 * của rate card hiệu lực ngày gửi. Kiểm chứng 94/95 đơn khớp từng đồng; đơn lệch
 * (SV-0075: −8.482đ so ô package 4 kg) là dữ liệu cần ops soi, không phải quy luật.
 * Phần thuần: khopOBangGia. Phần DB: layOBangGia.
 */
import { sql } from 'drizzle-orm';
import { ngayKinhDoanh } from '@/lib/timezone';
import { db } from '@/db/client';

export interface OBangGia { kg: number; loaiGoi: string; vnd: number }

export type KetQuaKhopO =
  | { khop: true; o: OBangGia | null }
  | { khop: false; ganNhat: OBangGia | null; lechVnd: number | null };

/** Sai số làm tròn cho phép khi so cước net bill với ô bảng giá (VND). */
export const SAI_SO_O_BANG_GIA_VND = 1;

export function khopOBangGia(netVnd: number, cells: readonly OBangGia[]): KetQuaKhopO {
  // Bill thiếu cột base (net ≤ 0) → không có gì để so; không báo nhiễu.
  if (!(netVnd > 0)) return { khop: true, o: null };
  let ganNhat: OBangGia | null = null;
  for (const c of cells) {
    if (Math.abs(c.vnd - netVnd) <= SAI_SO_O_BANG_GIA_VND) return { khop: true, o: c };
    if (ganNhat == null || Math.abs(c.vnd - netVnd) < Math.abs(ganNhat.vnd - netVnd)) ganNhat = c;
  }
  return { khop: false, ganNhat, lechVnd: ganNhat == null ? null : Math.round(netVnd - ganNhat.vnd) };
}

/**
 * THUẦN: CÂN ĐÃ TÍNH TIỀN của một dòng bill — lấy mốc cân của ô biểu giá mà cước net trùng.
 *
 * Vì sao phải suy ngược từ tiền (đo 30/09/2026, 42 đơn kalisa của 2 kỳ đã phát hành):
 * cột cân trên bill FBO là cân FedEx CÂN ĐƯỢC, không phải cân tính cước — so với mốc cân của
 * ô mà chính hoá đơn trùng thì bằng nhau 8, THẤP HƠN 34, cao hơn 0, và giá trị rơi lung tung
 * (1,7 · 2,1 · 1,4) chứ không nằm trên bậc 0,5kg. FedEx làm tròn LÊN bậc để tính tiền rồi
 * không in bậc đó ra.
 *
 * Đường cũ — đưa cân cân được vào engine rồi để nó tự suy lại theo KÍCH THƯỚC BRAND KHAI —
 * sai khi brand khai thừa: #KLS1994 ra 4kg trong khi hoá đơn tính ô 3,5kg, #KLS2011 ra 2,5kg
 * trong khi hoá đơn tính ô 1,5kg. Suy từ tiền thì cân KHÔNG THỂ mâu thuẫn với số tiền cùng dòng.
 *
 * Không tra được ô → trả `roiVe` (số đang có). KHÔNG bịa cân.
 */
export function canTinhCuocTuO(ket: KetQuaKhopO, roiVe: number | null): number | null {
  if (ket.khop && ket.o != null && ket.o.kg > 0) return ket.o.kg;
  return roiVe;
}

/** Mọi ô (mốc cân × loại gói) của rate card hiệu lực tại `ngay` (YYYY-MM-DD) cho các zone chứa nước đích. */
export async function layOBangGia(carrierAccountId: string, countryCode: string, ngay: string | null): Promise<OBangGia[]> {
  const d = ngay ?? ngayKinhDoanh(new Date())!;
  const rows = await db.execute(sql`
    select t.upper_kg as kg, c.package_type as loai_goi, c.cost_amount as vnd
    from carrier_rate_cells c
    join carrier_rate_cards rc on rc.id = c.rate_card_id
    join carrier_weight_tiers t on t.id = c.carrier_weight_tier_id
    join carrier_zone_countries zc on zc.carrier_zone_id = c.carrier_zone_id
    where rc.carrier_account_id = ${carrierAccountId}
      and rc.effective_from <= ${d}::date and (rc.effective_to is null or rc.effective_to >= ${d}::date)
      and zc.country_code = ${countryCode}
  `);
  return (rows.rows as Array<{ kg: unknown; loai_goi: unknown; vnd: unknown }>).map((r) => ({
    kg: Number(r.kg), loaiGoi: String(r.loai_goi ?? 'package'), vnd: Number(r.vnd),
  }));
}
