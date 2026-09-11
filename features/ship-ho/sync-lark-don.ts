/**
 * Đồng bộ bảng Lark "đơn ship hộ" của đội logistics vào hệ thống (CEO 11/09/2026).
 *
 * Hai việc:
 *   1. Đơn đã có (ghép theo MÃ VẬN ĐƠN) → sửa NGÀY GỬI về ngày trên Lark, vì ngày trên
 *      hệ thống là ngày ngồi nhập chứ không phải ngày đi hàng (98/99 đơn lệch, có đơn 6 ngày).
 *   2. Đơn Lark chưa có trong hệ thống → tạo mới, để Đức chỉ cần thêm dòng trên Lark.
 *
 * Một chiều Lark → hệ thống. KHÔNG ghi ngược lên Lark.
 */
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listShipHoDonRecords } from '@/features/lark/client';
import { docDongLark, ghepBrand, duDeTao, type DongLarkDon } from './lark-don';

export interface KetQuaSyncLark {
  doc: number;
  suaNgayGui: number;
  taoMoi: number;
  boQua: number;
  /** Lý do bỏ qua → số dòng, để biết cần sửa gì trên Lark. */
  lyDoBoQua: Record<string, number>;
  /** Vài ví dụ đổi ngày để đối chiếu bằng mắt. */
  viDu: string[];
  dryRun: boolean;
}

export interface TuyChonSyncLark {
  dryRun?: boolean;
  /** Chỉ xét dòng có ngày gửi từ mốc này trở đi — tránh tạo lại lịch sử quá cũ. */
  tuNgay?: string | null;
}

/**
 * Mốc mặc định: đơn ship hộ cũ nhất trong hệ thống gửi 28/05/2026. Lark còn 80 dòng
 * từ 2025 chưa từng vào hệ thống; tạo lại cả khối đó sẽ dựng lên lịch sử mà hệ thống
 * chưa bao giờ quản, làm lệch mọi báo cáo kỳ cũ. Muốn nạp thì chạy tay với `tuNgay` khác.
 */
export const MOC_MAC_DINH = process.env.SHIP_HO_LARK_TU_NGAY ?? '2026-05-01';

export async function syncLarkDonShipHo(opts: TuyChonSyncLark = {}): Promise<KetQuaSyncLark> {
  const dryRun = opts.dryRun ?? false;
  const tuNgay = opts.tuNgay === undefined ? MOC_MAC_DINH : opts.tuNgay;
  const recs = await listShipHoDonRecords();
  const dong = recs.map((r) => docDongLark(r.record_id, r.fields));

  const brands = await db.select({ slug: schema.mmpBrands.slug, ten: schema.mmpBrands.displayName }).from(schema.mmpBrands);
  const hienCo = await db.select({
    id: schema.shipHoOrders.id, code: schema.shipHoOrders.code,
    tracking: schema.shipHoOrders.trackingNumber, shippedAt: schema.shipHoOrders.shippedAt,
    larkRecordId: schema.shipHoOrders.larkRecordId,
  }).from(schema.shipHoOrders);

  const theoTracking = new Map<string, (typeof hienCo)[number]>();
  const theoRecord = new Map<string, (typeof hienCo)[number]>();
  for (const o of hienCo) {
    if (o.tracking) theoTracking.set(o.tracking.trim(), o);
    if (o.larkRecordId) theoRecord.set(o.larkRecordId, o);
  }

  const kq: KetQuaSyncLark = { doc: dong.length, suaNgayGui: 0, taoMoi: 0, boQua: 0, lyDoBoQua: {}, viDu: [], dryRun };
  const boQua = (ly: string) => { kq.boQua += 1; kq.lyDoBoQua[ly] = (kq.lyDoBoQua[ly] ?? 0) + 1; };

  for (const d of dong) {
    if (tuNgay && (!d.ngayGui || d.ngayGui < tuNgay)) { boQua(`ngày gửi trước ${tuNgay}`); continue; }
    const co = (d.trackingNumber && theoTracking.get(d.trackingNumber)) || theoRecord.get(d.recordId) || null;

    if (co) {
      // Đã có đơn: chỉ sửa ngày gửi (và gắn liên kết Lark), KHÔNG đụng tiền hay trạng thái —
      // những thứ đó hệ thống đã có nguồn riêng là hoá đơn carrier.
      const doiNgay = d.ngayGui != null && d.ngayGui !== co.shippedAt;
      if (!doiNgay && co.larkRecordId === d.recordId) { boQua('đã khớp, không có gì đổi'); continue; }
      if (doiNgay) {
        kq.suaNgayGui += 1;
        if (kq.viDu.length < 10) kq.viDu.push(`${co.code}: ${co.shippedAt ?? '—'} → ${d.ngayGui} (Lark ${d.maLark ?? '?'})`);
      }
      if (!dryRun) {
        await db.update(schema.shipHoOrders).set({
          ...(doiNgay ? { shippedAt: d.ngayGui } : {}),
          larkRecordId: d.recordId,
          larkOrderNumber: d.maLark,
          larkSyncedAt: new Date(),
        }).where(eq(schema.shipHoOrders.id, co.id));
      }
      continue;
    }

    const slug = ghepBrand(d.brandText, brands);
    const thieu = duDeTao(d, slug);
    if (thieu) { boQua(thieu); continue; }
    kq.taoMoi += 1;
    if (kq.viDu.length < 10) kq.viDu.push(`TẠO ${d.maLark} · ${slug} · ${d.nuoc} · ${d.canKg}kg · gửi ${d.ngayGui}`);
    if (!dryRun) await taoDon(d, slug!);
  }
  return kq;
}

/** Mã đơn cho dòng mới: giữ nguyên mã Lark; trùng thì thêm hậu tố để không vỡ ràng buộc unique. */
async function maDonTrong(goc: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const thu = i === 0 ? goc : `${goc}-${i + 1}`;
    const [co] = await db.select({ id: schema.shipHoOrders.id }).from(schema.shipHoOrders)
      .where(eq(schema.shipHoOrders.code, thu)).limit(1);
    if (!co) return thu;
  }
  return `${goc}-${Date.now()}`;
}

/** Account carrier để hệ thống báo giá được; Lark chỉ nói tên hãng. */
async function accountCuaHang(carrierKey: string | null): Promise<string | null> {
  if (!carrierKey) return null;
  const [r] = await db.select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(eq(schema.carriers.key, carrierKey), eq(schema.carrierAccounts.enabled, true)))
    .limit(1);
  return r?.id ?? null;
}

async function taoDon(d: DongLarkDon, brandSlug: string): Promise<void> {
  const code = await maDonTrong(d.maLark ?? `LARK-${d.recordId}`);
  await db.insert(schema.shipHoOrders).values({
    code,
    partnerBrandSlug: brandSlug,
    recipientName: d.nguoiNhan,
    recipientPhone: d.dienThoai,
    recipientEmail: d.email,
    country: d.nuoc!,
    city: d.thanhPho,
    postcode: d.maBuuChinh,
    address1: d.diaChi,
    houseNumber: d.soNha,
    weightKg: String(d.canKg),
    source: 'lark',
    carrierKey: d.carrierKey,
    carrierAccountId: await accountCuaHang(d.carrierKey),
    trackingNumber: d.trackingNumber,
    shippedAt: d.ngayGui,
    // KHÔNG ghi tiền từ Lark: giá chi lấy từ hoá đơn FedEx (cron đối soát), giá thu do
    // hệ thống báo theo bảng giá brand + markup theo bậc.
    chargedVnd: null,
    carrierCostVnd: null,
    larkRecordId: d.recordId,
    larkOrderNumber: d.maLark,
    larkSyncedAt: new Date(),
    // Có mã vận đơn nghĩa là hàng đã đi — 'shipped' là trạng thái đúng nhất mà không
    // giả định gì thêm về tiền hay việc đã giao.
    status: 'shipped',
  });
}

/** Đơn ship hộ chưa gắn dòng Lark nào — để biết còn bao nhiêu chỗ lệch. */
export async function demDonChuaGanLark(): Promise<number> {
  const [r] = await db.select({ n: sql<string>`COUNT(*)::text` }).from(schema.shipHoOrders)
    .where(and(or(isNull(schema.shipHoOrders.larkRecordId), eq(schema.shipHoOrders.larkRecordId, '')), sql`TRUE`));
  return Number(r?.n ?? 0);
}
