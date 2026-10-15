/**
 * SOÁT: báo giá của hãng KHÔNG có khoản vùng sâu xa, nhưng bảng ODA của CHÍNH MÌNH nói đích
 * đến là vùng sâu xa → nêu ra cho nhân sự, trước khi họ bấm ghi lên Lark.
 *
 * Vì sao cần (CEO 16/10/2026, sau ca `#MIR1028`): FedEx tra phụ phí vùng xa theo TÊN THÀNH
 * PHỐ ĐÃ CHUẨN HOÁ CỦA NÓ. Cùng mã bưu chính 52728, "Al Bukayriyah" (tên khách gõ trên
 * Shopify) ra báo giá KHÔNG có khoản đó, còn "BUKAYRIYAH" (tên hãng ghi trên nhãn) ra thêm
 * 550.000đ — cộng nhiên liệu và VAT trên nó là 898.425đ. Đường giá nay lấy tên từ Track API
 * nên ca đó đã khớp; nhưng khi hãng CHƯA có dữ liệu tra cứu (nhãn vừa tạo) thì vẫn rơi về tên
 * Shopify, và khoản tiền lại biến mất KHÔNG BÁO GÌ. Đây là lá chắn cho đúng cửa sổ đó.
 *
 * Soát này KHÔNG đổi một con số nào — chỉ thêm một câu cảnh báo. Bảng ODA của mình có thể cũ
 * hơn của hãng, và hãng có quyền không thu; nên câu chữ phải là "có thể thiếu, vào cổng kiểm",
 * tuyệt đối không phải "hãng tính sai".
 *
 * ĐÃ ĐO ĐỘ CHÍNH XÁC trước khi bật, vì một cảnh báo kêu bừa là cảnh báo không ai đọc. Đối
 * chiếu bảng ODA của mình với 300 dòng hoá đơn FedEx thật:
 *   khớp theo MÃ BƯU CHÍNH : hoá đơn CÓ thu 26 · không thu  2  → đúng  93%
 *   khớp theo TÊN THÀNH PHỐ: hoá đơn CÓ thu  3 · không thu  0  → đúng 100%
 *   không khớp gì          : hoá đơn CÓ thu  7 · không thu 262 → bỏ sót 7 (2,6%)
 * Và tần suất kêu trên 239 kiện 30 ngày: 18 ca khớp mã (8%), 1 ca khớp tên (0,4%).
 * Tức ~1/12 kiện có cảnh báo, và 9/10 cảnh báo là THẬT có khoản tiền bị thiếu.
 *
 * Dùng LẠI `matchRemoteTier` của engine chứ không tự viết phép dò thứ hai: luật khớp thành phố
 * thật sự phức tạp (alias chính tả, bỏ tiền tố "AL", khớp rìa prefix/suffix — xem
 * `remote-city-match.ts`), và một bản dò tự chế sẽ vừa bỏ sót vừa báo bừa. Bản nháp đầu của
 * việc này tự viết SQL so chuỗi và đã gắn cờ cả New York, Chicago là vùng sâu xa.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { matchRemoteTier } from '@/features/carrier-rates/engine/remote-match';

export interface VaoSoatVungXa {
  carrierKey: string;
  country: string;
  postcode: string | null;
  /** Tên thành phố ĐÃ DÙNG để hỏi giá — tên hãng chuẩn hoá nếu đọc được nhãn, không thì tên
   *  Shopify. Truyền đúng thứ đã hỏi thì cảnh báo mới nói đúng chuyện. */
  thanhPho: string | null;
  /** Khoản vùng xa trong báo giá. `null` = nguồn không nói gì, `0` = nói là không có. */
  remoteDaBao: number | null;
  ngay: Date;
}

/** THUẦN: câu cảnh báo. Tách khỏi I/O để có test canh — đây là câu người ta đọc rồi quyết
 *  định có mở cổng hãng ra kiểm hay không. */
export function cauCanhBaoVungXa(tier: string | null, khopTheo: string, thanhPho: string | null): string {
  const bac = tier ? ` (${tier})` : '';
  const theo = khopTheo === 'city' ? `tên thành phố "${thanhPho ?? '?'}"` : `mã bưu chính`;
  return `báo giá KHÔNG có phụ phí vùng sâu xa, nhưng bảng ODA của mình khớp ${theo}${bac}`
    + ' — có thể hãng tra theo tên khác và khoản này bị thiếu; mở cổng hãng kiểm con số tổng trước khi ghi';
}

/**
 * I/O. Trả `null` khi KHÔNG có gì để nói — gồm cả khi báo giá đã có khoản vùng xa, khi không
 * tra được tài khoản hãng, hoặc khi bảng ODA không khớp.
 *
 * Nuốt mọi lỗi: đây là lá chắn phụ, hỏng nó KHÔNG được làm chết cả lượt phân tích (nhân sự
 * vẫn phải lưu được mã vận đơn).
 */
export async function soatVungXa(v: VaoSoatVungXa): Promise<string | null> {
  if (v.remoteDaBao != null && v.remoteDaBao > 0) return null; // hãng đã tính rồi
  try {
    const [acc] = await db.select({ id: schema.carrierAccounts.id })
      .from(schema.carrierAccounts)
      .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
      .where(and(
        eq(schema.carriers.key, v.carrierKey),
        eq(schema.carrierAccounts.enabled, true),
        isNull(schema.carrierAccounts.suspendedAt),
      )).limit(1);
    if (!acc) return null;

    const snap = await loadAccountSnapshot(acc.id, v.ngay, {
      remoteCountry: v.country,
      remotePostcodes: [v.postcode],
    });
    if (!snap) return null;

    const { tier, matchedBy } = matchRemoteTier(
      snap.remotePostcodes.get(v.country), v.postcode, v.thanhPho,
      snap.remotePostcodeRanges?.get(v.country),
    );
    if (matchedBy == null) return null;
    return cauCanhBaoVungXa(tier, matchedBy, v.thanhPho);
  } catch {
    return null;
  }
}
