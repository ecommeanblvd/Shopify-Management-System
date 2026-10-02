/**
 * I/O cho trang dẫn nguồn phụ phí (CEO 02/10/2026).
 *
 * Toàn bộ LUẬT nằm ở `loai-phu-phi.ts` (loại nào được hiện) và `tuan-dau.ts` (tuần nào thuộc
 * brand); tệp này chỉ đọc dữ liệu rồi nối lại. Đọc MỘT LƯỢT cho cả trang — không truy vấn theo
 * từng dòng.
 */
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ngayKinhDoanh } from '@/lib/timezone';
import { loaiChoPhep, type DongBangKe } from './loai-phu-phi';
import { locTuanCoDon, type TuanDau } from './tuan-dau';
import { cachTinhThat, dinhDangGiaTri, maNuoc, ngay, tenTuNote } from './trinh-bay';
import { FEDEX_SURCHARGE_PAGE_URL } from '@/features/carrier-rates/fuel-fetcher/fedex';
import { DHL_VN_PAGE_URL } from '@/features/carrier-rates/fuel-fetcher/dhl-vn';
import { UPS_FUEL_PAGE_URL } from '@/features/carrier-rates/fuel-fetcher/ups';
import { SF_FUEL_PAGE_URL } from '@/features/carrier-rates/fuel-fetcher/sf';

export interface DongPhuPhi {
  dong: DongBangKe;
  nhan: string;
  cachTinh: string;
  /** Mức đã định dạng để hiện ("38,50%", "550.000đ/đơn", "9.200đ/kg"). */
  giaTri: string;
  hieuLucTu: string | null;
  /** Tên riêng của dòng theo cách hãng gọi ("FedEx ODA Tier B", "Sai địa chỉ"), hoặc `null`. */
  tenDong: string | null;
  /** Nhãn mức của hãng ("Tier A", "Remote"), hoặc `null`. */
  mucHang: string | null;
  /** ISO-2 các nước BỊ áp dòng này; `null` = áp mọi nước. */
  apDungNuoc: string[] | null;
  /** ISO-2 các nước ĐƯỢC MIỄN dòng này; `null` = không miễn nước nào. */
  mienNuoc: string[] | null;
}

export interface TepBangChung { id: string; label: string; tu: string | null; den: string | null }

export interface HangTrenTrang {
  carrierAccountId: string;
  tenHang: string;
  /** Đơn vị tiền của mọi con số tiền trong `dong` — xem ghi chú ở `tien()`. */
  donViTien: string;
  linkHang: string | null;
  dong: DongPhuPhi[];
  tuanDau: TuanDau[];
  tep: TepBangChung[];
}

export interface TrangPhuPhi { brandSlug: string; tenBrand: string; hang: HangTrenTrang[] }

/**
 * Hãng KHÔNG có trang công bố (Aramex) → `null`, và trang bỏ hẳn dòng link.
 * KHÔNG trỏ sang trang chủ: một link không dẫn tới con số nào thì tệ hơn không có link, vì
 * brand bấm vào, không thấy gì, rồi hỏi lại.
 */
function linkHang(ten: string): string | null {
  const t = ten.toLowerCase();
  if (t.startsWith('fedex')) return FEDEX_SURCHARGE_PAGE_URL;
  if (t.startsWith('dhl')) return DHL_VN_PAGE_URL;
  if (t.startsWith('ups')) return UPS_FUEL_PAGE_URL;
  if (t.startsWith('sf ')) return SF_FUEL_PAGE_URL;
  return null;
}

/** `null` = token sai hoặc đã thu hồi. Người gọi trả 404, KHÔNG phân biệt hai ca. */
export async function docTrangPhuPhi(token: string): Promise<TrangPhuPhi | null> {
  const [link] = await db.select({ slug: schema.brandSurchargeLinks.partnerBrandSlug })
    .from(schema.brandSurchargeLinks)
    .where(and(eq(schema.brandSurchargeLinks.token, token), isNull(schema.brandSurchargeLinks.revokedAt)))
    .limit(1);
  if (!link) return null;

  const [brand] = await db.select({ ten: schema.mmpBrands.displayName })
    .from(schema.mmpBrands).where(eq(schema.mmpBrands.slug, link.slug)).limit(1);
  const tenBrand = brand?.ten ?? link.slug;

  /* Hãng brand ĐÃ ĐI, MỌI THỜI ĐIỂM (CEO 02/10): đối soát có thể lùi xa, một hãng chỉ đi một
   * lần hồi tháng 5 vẫn cần căn cứ. Đơn thiếu `carrier_account_id` thì BỎ QUA — không đoán hãng
   * từ `carrier_key`, vì đoán sai là dẫn brand tới phụ phí của hãng khác. */
  const donRows = await db.select({
    acc: schema.shipHoOrders.carrierAccountId, ngayGui: schema.shipHoOrders.shippedAt,
  }).from(schema.shipHoOrders)
    .where(and(
      eq(schema.shipHoOrders.partnerBrandSlug, link.slug),
      isNotNull(schema.shipHoOrders.carrierAccountId),
    ));
  const accIds = [...new Set(donRows.map((r) => r.acc!))];
  if (accIds.length === 0) return { brandSlug: link.slug, tenBrand, hang: [] };

  const ngayTheoHang = new Map<string, string[]>();
  for (const r of donRows) {
    if (!r.ngayGui) continue;
    const g = ngayTheoHang.get(r.acc!) ?? [];
    g.push(String(r.ngayGui).slice(0, 10));
    ngayTheoHang.set(r.acc!, g);
  }

  const accs = await db.select({
    id: schema.carrierAccounts.id, name: schema.carrierAccounts.name,
    tien: schema.carrierAccounts.costCurrency,
  }).from(schema.carrierAccounts).where(inArray(schema.carrierAccounts.id, accIds));

  const sur = await db.select({
    acc: schema.carrierSurcharges.carrierAccountId, kind: schema.carrierSurcharges.kind,
    value: schema.carrierSurcharges.value, valuePerKg: schema.carrierSurcharges.valuePerKg,
    stepKg: schema.carrierSurcharges.stepKg, serviceKey: schema.carrierSurcharges.serviceKey,
    tier: schema.carrierSurcharges.tier, note: schema.carrierSurcharges.note,
    apDung: schema.carrierSurcharges.countryCodes, mien: schema.carrierSurcharges.excludedCountryCodes,
    startsAt: schema.carrierSurcharges.startsAt, endsAt: schema.carrierSurcharges.endsAt,
  }).from(schema.carrierSurcharges)
    .where(and(
      inArray(schema.carrierSurcharges.carrierAccountId, accIds),
      eq(schema.carrierSurcharges.active, true),
    ));

  /* CHỈ tệp được tick `chia_se_brand`. Không phải mọi tệp của hãng brand đã đi: bảng này nhận
   * cả danh sách mã bưu chính lẫn bảng giá — "DHL Service & Rate Guide 2025" trong đó có nguyên
   * bảng cước xuất khẩu theo vùng (kg × Vùng 1–8). Danh sách cho phép, như với `kind`. */
  const tepRows = await db.select({
    id: schema.carrierRemoteEvidence.id, acc: schema.carrierRemoteEvidence.carrierAccountId,
    label: schema.carrierRemoteEvidence.label,
    tu: schema.carrierRemoteEvidence.effectiveFrom, den: schema.carrierRemoteEvidence.effectiveTo,
  }).from(schema.carrierRemoteEvidence)
    .where(and(
      inArray(schema.carrierRemoteEvidence.carrierAccountId, accIds),
      eq(schema.carrierRemoteEvidence.chiaSeBrand, true),
    ));

  /* Giờ KINH DOANH, không phải UTC: Railway chạy TZ=UTC, nên sau 7h sáng giờ VN hai mốc đã
   * khác ngày. `lib/ngay-vn.test.ts` quét cả repo để chặn `toISOString()` ở đúng chỗ này. */
  const homNay = ngayKinhDoanh(new Date()) ?? '9999-12-31';

  const hang: HangTrenTrang[] = accs.map((a) => {
    const cua = sur.filter((s) => s.acc === a.id);

    /* Dầu đi ĐƯỜNG RIÊNG: nó là loại duy nhất cần lịch sử (đổi hàng tuần, hãng chỉ công bố
     * tuần hiện tại), nên lấy MỌI dòng kể cả đã đóng kỳ rồi lọc theo ngày gửi của brand. */
    const tuanDau = locTuanCoDon(
      cua.filter((s) => s.kind === 'fuel_percent')
        .map((s) => ({ tu: ngay(s.startsAt) ?? '', den: ngay(s.endsAt), phanTram: Number(s.value) }))
        .filter((w) => w.tu !== ''),
      ngayTheoHang.get(a.id) ?? [],
      homNay,
    );

    /* Các loại khác CHỈ lấy mức đang mở (`ends_at IS NULL`): chúng gần như không đổi — ngày
     * hiệu lực lùi tới 2025 — nên lịch sử không nói thêm gì mà làm trang dài ra. */
    const dong: DongPhuPhi[] = [];
    for (const s of cua) {
      if (s.kind === 'fuel_percent' || s.endsAt != null) continue;
      const mo = loaiChoPhep(s.kind, s.serviceKey);
      if (!mo) continue; // markup_percent và mọi kind chưa khai đều rơi vào đây
      const perKg = s.valuePerKg == null ? null : Number(s.valuePerKg);
      dong.push({
        dong: mo.dong, nhan: mo.nhan, cachTinh: cachTinhThat(mo.cachTinh, perKg),
        giaTri: dinhDangGiaTri(s.kind, Number(s.value), perKg, s.stepKg == null ? null : Number(s.stepKg), a.tien),
        hieuLucTu: ngay(s.startsAt),
        tenDong: tenTuNote(s.note), mucHang: s.tier,
        apDungNuoc: maNuoc(s.apDung), mienNuoc: maNuoc(s.mien),
      });
    }
    /* `note` không lên trang NGUYÊN VĂN — xem `tenTuNote`. Đọc dữ liệu thật
     * 02/10 thì nó là sổ tay NỘI BỘ: "hoá đơn thật US 95%, GB 88%, KW 94%" (tỉ lệ mình tự
     * khảo hoá đơn), "kiện đầu #MBLVD29935 RO" (mã kiện của BRAND KHÁC), "CEO duyệt
     * 10/09/2026", "backfill PDF". Một trang gửi brand không mang theo những thứ đó.
     * Thứ brand thật sự cần để đối soát — dòng này áp nước nào, miễn nước nào — nằm ở hai cột
     * CÓ CẤU TRÚC `country_codes` / `excluded_country_codes`, nên lấy từ đó. */
    // Sắp theo thứ tự dòng trên bảng kê để brand đối chiếu từ trên xuống.
    const thuTu: DongBangKe[] = ['fuel', 'remote', 'demand', 'residential', 'signature', 'vat', 'other'];
    dong.sort((x, y) => thuTu.indexOf(x.dong) - thuTu.indexOf(y.dong) || x.nhan.localeCompare(y.nhan));

    return {
      carrierAccountId: a.id, tenHang: a.name, donViTien: a.tien, linkHang: linkHang(a.name),
      dong, tuanDau,
      tep: tepRows.filter((t) => t.acc === a.id)
        .map((t) => ({ id: t.id, label: t.label, tu: ngay(t.tu), den: ngay(t.den) })),
    };
  }).sort((x, y) => x.tenHang.localeCompare(y.tenHang));

  return { brandSlug: link.slug, tenBrand, hang };
}

/**
 * `file_key` của một tệp bằng chứng, hoặc `null`.
 *
 * Kiểm BA điều: token còn hiệu lực · tệp được tick `chia_se_brand` · tệp thuộc một hãng brand
 * đó đã đi. Thiếu phép kiểm cuối thì brand chỉ cần đổi `evidenceId` trên URL là tải được tài
 * liệu của hãng họ chưa bao giờ dùng — một link hợp lệ thành chìa khoá cho cả kho tài liệu.
 *
 * Phép kiểm `chia_se_brand` phải lặp lại Ở ĐÂY chứ không dựa vào việc trang không in link ra:
 * route này gọi được thẳng bằng URL, nó không biết trang đã hiện gì.
 */
export async function tepThuocBrand(token: string, evidenceId: string): Promise<string | null> {
  const [link] = await db.select({ slug: schema.brandSurchargeLinks.partnerBrandSlug })
    .from(schema.brandSurchargeLinks)
    .where(and(eq(schema.brandSurchargeLinks.token, token), isNull(schema.brandSurchargeLinks.revokedAt)))
    .limit(1);
  if (!link) return null;

  const [tep] = await db.select({
    key: schema.carrierRemoteEvidence.fileKey, acc: schema.carrierRemoteEvidence.carrierAccountId,
  }).from(schema.carrierRemoteEvidence)
    .where(and(
      eq(schema.carrierRemoteEvidence.id, evidenceId),
      eq(schema.carrierRemoteEvidence.chiaSeBrand, true),
    )).limit(1);
  if (!tep?.key) return null;

  const [daDi] = await db.selectDistinct({ acc: schema.shipHoOrders.carrierAccountId })
    .from(schema.shipHoOrders)
    .where(and(
      eq(schema.shipHoOrders.partnerBrandSlug, link.slug),
      eq(schema.shipHoOrders.carrierAccountId, tep.acc),
    )).limit(1);
  return daDi ? tep.key : null;
}
