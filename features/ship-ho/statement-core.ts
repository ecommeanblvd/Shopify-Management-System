/**
 * Lõi không-auth cho bảng kê ship hộ: tính lại tổng một bảng kê còn NHÁP theo LOẠI —
 * cước (freight) chỉ tính giá thực đã chốt đối soát; duty tính theo actual_duty_vnd
 * của các đơn đã gán vào kê (CEO 21/09/2026, thay luật 08/09).
 * Dùng bởi server action (nút "Tính lại tổng") và script bảo trì. Bảng kê đã
 * issued/paid KHÔNG tính lại — số đã gửi brand phải đứng yên.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { chiaDonTrongKe, summarizeStatement, QUYET_DINH_DA_CHOT } from './statement-logic';
import type { LoaiBangKe } from './statement-logic';
import { kyThang, viecGom, kyTuTen, chonKyGom, type LyDoKy } from './ky-bang-ke';
import { giaThuBangKe } from './statement-logic';
import { getShipHoStatement } from './statement-queries';
import { payloadStatementIssued, payloadStatementAdjustment, type DongBangKeMmp } from './statement-push';
import { docDongDieuChinh, docAnhChup, tinhDongDieuChinh } from './dieu-chinh';
import { banSuKienBangKe } from './statement-outbox';
import { khoanPhiChoBangKe } from './bang-ke-khoan-phi-queries';
import { canBangMienThu } from './bang-ke-khoan-phi';
import { kiemCongChotKy, type DonKiemCong, type LoiCong } from './cong-chot-ky';
import { ngayDiHang } from './ngay-di-hang';
import type { TuanFuel } from './tuan-fuel';

export async function tinhLaiTongBangKe(id: string): Promise<{
  ok: boolean; error?: string; orderCount: number; totalChargedVnd: number; truoc?: number;
  /** Số đơn bị GỠ khỏi kê draft vì chưa chốt được giá (N2, review 21/09/2026) — id vẫn còn
   *  ở đơn (statement_id gỡ về null) nhưng không góp vào tổng, để kỳ sau nhặt lại được. */
  daGo?: number;
  daGoMa?: string[];
}> {
  const [st] = await db.select({ status: schema.shipHoStatements.status, type: schema.shipHoStatements.type, total: schema.shipHoStatements.totalChargedVnd })
    .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return { ok: false, error: 'Không tìm thấy bảng kê', orderCount: 0, totalChargedVnd: 0 };
  if (st.status !== 'draft') return { ok: false, error: 'Bảng kê đã gửi/đã thu — không tính lại', orderCount: 0, totalChargedVnd: 0 };
  const tien: number[] = [];
  let daGo = 0;
  let daGoMa: string[] = [];
  if (st.type === 'freight') {
    const orders = await db.select({
      id: schema.shipHoOrders.id,
      code: schema.shipHoOrders.code,
      status: schema.shipHoOrders.status,
      actualChargedVnd: schema.shipHoOrders.actualChargedVnd,
      reconcileStatus: schema.shipHoOrders.reconcileStatus,
      // Đơn còn 'pending_review'/'claiming' không được tính vào tổng (spec §2.2).
      reconcileDecision: schema.shipHoOrders.reconcileDecision,
    })
      .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id));
    const { thu, go } = chiaDonTrongKe(orders);
    tien.push(...thu);
    if (go.length > 0) {
      // Gỡ hẳn khỏi kê draft (statement_id = NULL) — nếu không, đơn kẹt trong kê này
      // mãi mãi (không tính vào tổng NHƯNG cũng không kỳ nào của generateStatement
      // nhặt lại được, vì statement_id vẫn khác null). status='billed' (đã gán vào
      // kê ở generateStatement) lùi về 'shipped' để đơn hiện lại đúng chỗ; các
      // status khác (shipped/delivered/settled — hiếm khi rơi vào đây) giữ nguyên.
      const goSet = new Set(go);
      const goBilledIds = orders.filter((o) => goSet.has(o.id) && o.status === 'billed').map((o) => o.id);
      await db.update(schema.shipHoOrders).set({ statementId: null }).where(inArray(schema.shipHoOrders.id, go));
      if (goBilledIds.length > 0) {
        await db.update(schema.shipHoOrders).set({ status: 'shipped' }).where(inArray(schema.shipHoOrders.id, goBilledIds));
      }
      daGo = go.length;
      daGoMa = orders.filter((o) => goSet.has(o.id)).map((o) => o.code);
    }
  } else {
    const orders = await db.select({ duty: schema.shipHoOrders.actualDutyVnd }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.dutyStatementId, id));
    for (const o of orders) if (o.duty != null) tien.push(Number(o.duty));
  }
  const sums = summarizeStatement(tien);
  await db.update(schema.shipHoStatements).set({ orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd) }).where(eq(schema.shipHoStatements.id, id));
  return { ok: true, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, truoc: Number(st.total), daGo, daGoMa };
}

/** Một đơn đủ điều kiện vào kê, kèm MỐC KỲ của nó. */
export interface DonVaoKe { id: string; tien: number; moc: Date }

/**
 * Lõi KHÔNG-AUTH: gom đơn đủ điều kiện vào một kỳ. Dùng chung bởi server action
 * `generateStatement` (nút bấm tay) và lệnh tự động — một nguồn sự thật duy nhất
 * cho điều kiện "được vào bảng kê" (D-125).
 *
 * MỐC KỲ = `occurred_at` của LẦN ĐẨY ĐẦU TIÊN `order.reconciled` sang MMP (CEO 01/10/2026,
 * nhận đề xuất MMP). Lấy lần ĐẦU, không phải lần gần nhất: bắn lại khi tách duty thì không
 * kéo đơn của kỳ đã khoá sang kỳ mới.
 *
 * KHÔNG lọc `delivery_status = 'delivered'` nữa — bỏ chữ "THÀNH CÔNG" khỏi mốc. Lý do của
 * MMP đúng và SMS đã tự bị cắn một lần: gắn kỳ kế toán vào chất lượng đường truyền thì một cú
 * 409 hay một lần đối tác bảo trì sẽ ĐẨY DOANH THU SANG THÁNG KHÁC mà không ai sai (ba đơn
 * `26-INSLG-SV-0957/0995/0912` vừa kẹt 12 ngày vì đúng cái 409 đó). `occurred_at` là mốc
 * nghiệp vụ, bền qua mọi lần thử lại.
 * Đo 01/10 trước khi đổi: bỏ lọc làm mốc đổi ở 3 đơn, **0 đơn đổi THÁNG**; duty 76/76 đều
 * `delivered` nên không đổi gì. Tức đổi luật này hôm nay là MIỄN PHÍ, chỉ chặn trước tương lai.
 *
 * `periodStart`/`periodEnd` bỏ trống = KHÔNG bó cửa sổ: người gọi tự xếp đơn theo mốc của nó
 * (xem `goBangKeNhap`). Nút bấm tay vẫn truyền cửa sổ của đúng kỳ đang dựng.
 */
export async function donVaoKe(
  partnerBrandSlug: string, type: LoaiBangKe, periodStart?: string, periodEnd?: string,
): Promise<{ don: DonVaoKe[]; choHoaDon: number }> {
  const don: DonVaoKe[] = []; let choHoaDon = 0;
  // Cửa sổ bỏ trống → dải mở hai đầu, điều kiện BETWEEN luôn đúng.
  const dau = periodStart ?? '0001-01-01';
  const cuoi = periodEnd ?? '9999-12-31';
  if (type === 'freight') {
    const rows = await db.execute<{ id: string; gia: string | null; moc: string | null; cho: boolean }>(sql`
      SELECT o.id,
             CASE WHEN o.reconcile_status = 'reconciled'
                   AND (o.reconcile_decision IS NULL OR o.reconcile_decision IN ${QUYET_DINH_DA_CHOT})
                   AND p.push_dau IS NOT NULL AND p.push_dau::date BETWEEN ${dau} AND ${cuoi}
                  THEN o.actual_charged_vnd END AS gia,
             p.push_dau AS moc,
             ((o.actual_charged_vnd IS NULL OR o.reconcile_status IS DISTINCT FROM 'reconciled'
               OR (o.reconcile_decision IS NOT NULL AND o.reconcile_decision NOT IN ${QUYET_DINH_DA_CHOT}))
              AND o.shipped_at BETWEEN ${dau} AND ${cuoi}) AS cho
        FROM ship_ho_orders o
        LEFT JOIN LATERAL (
          SELECT min(e.occurred_at) AS push_dau FROM ship_ho_order_events e
           WHERE e.order_id = o.id AND e.event = 'order.reconciled'
        ) p ON TRUE
       WHERE o.partner_brand_slug = ${partnerBrandSlug} AND o.statement_id IS NULL
         AND o.status IN ('shipped','delivered')
         AND NOT (COALESCE(o.ly_do_cham,'') = 'khong_gui_hang' AND COALESCE(o.ly_do_doi_chieu,'') = 'xac_nhan')`);
    for (const r of rows.rows) {
      if (r.gia != null && r.moc != null) don.push({ id: r.id, tien: Number(r.gia), moc: new Date(r.moc) });
      else if (r.cho) choHoaDon++;
    }
  } else {
    const rows = await db.execute<{ id: string; gia: string; moc: string }>(sql`
      SELECT o.id, o.actual_duty_vnd AS gia, p.push_dau AS moc
        FROM ship_ho_orders o
        LEFT JOIN LATERAL (
          SELECT min(e.occurred_at) AS push_dau FROM ship_ho_order_events e
           WHERE e.order_id = o.id AND e.event = 'order.duty_charged'
        ) p ON TRUE
       WHERE o.partner_brand_slug = ${partnerBrandSlug} AND o.duty_statement_id IS NULL AND o.actual_duty_vnd > 0
         AND p.push_dau IS NOT NULL AND p.push_dau::date BETWEEN ${dau} AND ${cuoi}`);
    for (const r of rows.rows) don.push({ id: r.id, tien: Number(r.gia), moc: new Date(r.moc) });
  }
  return { don, choHoaDon };
}

export interface KetQuaGom {
  brand: string; type: LoaiBangKe; viec: string; don: number; tien: number; statementId?: string;
  /** Kỳ bảng kê được gom vào (`YYYY-MM`). */
  ky?: string;
  /** Vì sao đơn vào kỳ này: đúng kỳ của mốc, hay kỳ của mốc đã chốt nên phải dời. */
  ly?: LyDoKy;
}

/** Đơn KHÔNG xếp được vào kỳ nào, kèm lý do — đếm riêng từng lý do, không gộp. */
export interface DonChuaXep { brand: string; type: LoaiBangKe; ly: LyDoKy; don: number; tien: number }

/**
 * Lệnh TỰ ĐỘNG: gom đơn đã chốt giá vào bảng kê NHÁP của ĐÚNG KỲ CHỨA MỐC, cho mọi brand.
 * KHÔNG tự phát hành — chốt kỳ là việc kế toán, người bấm (CEO 28/09/2026).
 *
 * LUẬT GÁN KỲ (CEO 01/10/2026, nhận đề xuất MMP — thay luật 28/09):
 * kỳ của đơn = kỳ chứa mốc `order.reconciled` lần đầu. TRƯỚC ĐÂY xếp theo THÁNG LÚC CHẠY LỆNH
 * GOM, nên một đơn đẩy tháng 7 mà lệnh gom chạy tháng 9 thì nằm ở kỳ 9. Đo 01/10: 14 đơn /
 * 32.316.966đ nằm sai kỳ, và chính phép chiếu chéo "mốc kỳ phải nằm trong kỳ đó" mà hai bên
 * vừa thống nhất sẽ CHẶN PHÁT HÀNH vì SMS tự vi phạm nó.
 *
 * Kỳ của mốc đã `issued`/`paid` thì không mở lại — đơn đi tới KỲ ĐANG MỞ SỚM NHẤT
 * (`chonKyGom`), giống `assignBillingPeriod` bên MMP. Giữ nguyên bài học D-130: không đơn nào
 * bị kẹt không kỳ nào nhận.
 *
 * Idempotent: kỳ đã có bản nháp thì gom THÊM vào đúng bản đó rồi tính lại tổng từ chính các
 * đơn đã gán, không đẻ bản thứ hai và không cộng dồn con số cũ.
 */
export async function goBangKeNhap(now: Date = new Date()): Promise<KetQuaGom[]> {
  const kyNay = kyThang(now);
  const brands = await db.selectDistinct({ slug: schema.shipHoOrders.partnerBrandSlug })
    .from(schema.shipHoOrders);
  const ket: KetQuaGom[] = [];

  for (const { slug } of brands) {
    for (const type of ['freight', 'duty'] as const) {
      // KHÔNG bó cửa sổ: lấy mọi đơn đã chốt giá chưa kê, rồi tự xếp theo mốc của từng đơn.
      const { don } = await donVaoKe(slug, type);
      if (don.length === 0) continue;

      // Trạng thái bảng kê của brand+loại này theo kỳ — đọc MỘT LẦN, dùng cho cả vòng xếp.
      const keCu = await db.select({
        id: schema.shipHoStatements.id, periodStart: schema.shipHoStatements.periodStart,
        status: schema.shipHoStatements.status,
      }).from(schema.shipHoStatements).where(and(
        eq(schema.shipHoStatements.partnerBrandSlug, slug),
        eq(schema.shipHoStatements.type, type),
      ));
      const theoKy = new Map(keCu.map((k) => [String(k.periodStart).slice(0, 7), k]));
      const trangThai = (ten: string): string | null => theoKy.get(ten)?.status ?? null;

      const gio = new Map<string, { ly: LyDoKy; ids: string[]; tien: number[] }>();
      const chuaXep = new Map<LyDoKy, { don: number; tien: number }>();
      for (const d of don) {
        const chon = chonKyGom({ tenMoc: kyThang(d.moc).ten, tenHienTai: kyNay.ten, trangThai });
        if (chon.ten == null) {
          const c = chuaXep.get(chon.ly) ?? { don: 0, tien: 0 };
          chuaXep.set(chon.ly, { don: c.don + 1, tien: c.tien + d.tien });
          continue;
        }
        const g = gio.get(chon.ten) ?? { ly: chon.ly, ids: [], tien: [] };
        g.ids.push(d.id); g.tien.push(d.tien);
        gio.set(chon.ten, g);
      }

      for (const [ly, c] of chuaXep) {
        ket.push({ brand: slug, type, viec: `chua_xep:${ly}`, don: c.don, tien: c.tien, ly });
      }

      // Kỳ cũ trước kỳ mới: bản nháp của kỳ sớm phải đủ số trước khi ai đó đi phát hành nó.
      for (const ten of [...gio.keys()].sort()) {
        const g = gio.get(ten)!;
        const ky = kyTuTen(ten);
        const daCo = theoKy.get(ten);
        const viec = viecGom(daCo?.status);
        // chonKyGom đã loại kỳ đã chốt, nên nhánh này không xảy ra — giữ lại làm hàng rào.
        if (viec === 'bo_qua_da_chot') {
          ket.push({ brand: slug, type, viec, don: g.ids.length, tien: 0, ky: ten, ly: g.ly });
          continue;
        }
        const sums = summarizeStatement(g.tien);
        let id = daCo?.id;
        if (!id) {
          const [st] = await db.insert(schema.shipHoStatements).values({
            partnerBrandSlug: slug, type, periodStart: ky.dau, periodEnd: ky.cuoi,
            orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd), status: 'draft',
          }).returning({ id: schema.shipHoStatements.id });
          id = st!.id;
          theoKy.set(ten, { id, periodStart: ky.dau, status: 'draft' });
        }
        await db.update(schema.shipHoOrders)
          .set(type === 'freight' ? { statementId: id, status: 'billed' } : { dutyStatementId: id })
          .where(inArray(schema.shipHoOrders.id, g.ids));
        // Tính lại từ CHÍNH các đơn đã gán — không cộng dồn con số cũ.
        const lai = await tinhLaiTongBangKe(id);
        ket.push({ brand: slug, type, viec, don: lai.orderCount, tien: lai.totalChargedVnd, statementId: id, ky: ten, ly: g.ly });
      }
    }
  }
  return ket;
}

/**
 * Phép CHIẾU CHÉO (mục (e) đề xuất chốt kỳ, CEO 01/10/2026): đơn trong bảng kê KHÔNG nằm ở kỳ
 * mà luật gán kỳ sẽ đặt nó vào. Trả MÃ ĐƠN, không trả số đếm — người bấm phải biết đơn nào để
 * đi xem, "còn 3 đơn lệch kỳ" thì không ai tra được (đúng lỗi em đã gây một vòng lãng phí với
 * MMP, xem D-176).
 *
 * CHẶN phát hành, không cảnh báo suông: một cảnh báo không ai đọc thì bằng không có (D-177).
 *
 * KHÔNG so thẳng "mốc có nằm trong cửa sổ kỳ" — đó là bản đầu em viết và nó SAI. Đơn có mốc ở
 * một kỳ ĐÃ PHÁT HÀNH thì theo đúng luật hai bên thống nhất phải rơi vào kỳ đang mở sớm nhất,
 * nên mốc của nó nằm ngoài kỳ nó đang ở là HỢP LỆ. Đo 01/10 sau khi xếp lại: `26-INSLG-SV-0035`
 * (mốc kỳ 08, kỳ 08 đã phát hành, nằm ở kỳ 09) bị bản đầu báo lỗi — tức guard sẽ chặn vĩnh viễn
 * việc phát hành kỳ 09 của Kalisa.
 *
 * Nên phép kiểm hỏi đúng câu của luật: `chonKyGom` sẽ đặt đơn này vào kỳ nào? Khác kỳ nó đang
 * nằm thì mới là lỗi. Dùng LẠI hàm thuần đã có test thay vì mã hoá luật lần hai bằng SQL — hai
 * bản sao của một luật tiền là cách chắc nhất để chúng lệch nhau.
 *
 * Bảng kê ĐANG kiểm được coi là MỞ: nếu không, `chonKyGom` nhảy qua chính nó và mọi đơn đều lệch.
 */
export async function donLechKy(statementId: string): Promise<string[]> {
  const [st] = await db.select({
    brand: schema.shipHoStatements.partnerBrandSlug, type: schema.shipHoStatements.type,
    periodStart: schema.shipHoStatements.periodStart,
  }).from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, statementId)).limit(1);
  if (!st) return [];
  const tenKe = String(st.periodStart).slice(0, 7);

  const keCu = await db.select({
    periodStart: schema.shipHoStatements.periodStart, status: schema.shipHoStatements.status,
  }).from(schema.shipHoStatements).where(and(
    eq(schema.shipHoStatements.partnerBrandSlug, st.brand),
    eq(schema.shipHoStatements.type, st.type),
  ));
  const theoKy = new Map(keCu.map((k) => [String(k.periodStart).slice(0, 7), k.status]));
  const trangThai = (ten: string): string | null => (ten === tenKe ? null : theoKy.get(ten) ?? null);

  // `${statementId}` đi qua THAM SỐ, không nối chuỗi vào câu lệnh: id tới từ tham số server
  // action, nối tay là mở đường tiêm SQL ngay giữa luồng tiền.
  const r = await db.execute<{ code: string; moc: string | null }>(sql`
    SELECT o.code, p.push_dau AS moc
      FROM ship_ho_statements s
      JOIN ship_ho_orders o
        ON (CASE WHEN s.type = 'duty' THEN o.duty_statement_id ELSE o.statement_id END) = s.id
      LEFT JOIN LATERAL (
        SELECT min(e.occurred_at) AS push_dau FROM ship_ho_order_events e
         WHERE e.order_id = o.id
           AND e.event = CASE WHEN s.type = 'duty' THEN 'order.duty_charged' ELSE 'order.reconciled' END
      ) p ON TRUE
     WHERE s.id = ${statementId}::uuid
     ORDER BY o.code`);

  const lech: string[] = [];
  for (const x of r.rows) {
    // Không có mốc nào = chưa từng đẩy sang MMP. Phát hành đơn đó là gửi brand một dòng mà
    // MMP không có hồ sơ — đúng cái 409 đã tốn một vòng hỏi đáp (D-176).
    if (x.moc == null) { lech.push(x.code); continue; }
    const chon = chonKyGom({ tenMoc: kyThang(new Date(x.moc)).ten, tenHienTai: tenKe, trangThai });
    if (chon.ten !== tenKe) lech.push(x.code);
  }
  return lech;
}

/**
 * Dựng payload `statement.issued` rồi bắn sang MMP. Trả `null` khi không đọc được bảng kê.
 *
 * Tách ra để `setStatementStatus` (lượt phát hành) và `guiLaiBangKe` (lượt gửi lại) dùng CHUNG
 * một đường dựng payload. Hai bản sao của phép dựng bản đối soát là cách chắc nhất để bản gửi
 * lại khác bản đã gửi mà không ai thấy.
 */
export async function banBangKeSangMmp(id: string): Promise<{ ok: boolean; detail: string } | null> {
  /* Bảng kê ĐIỀU CHỈNH đi đường riêng: nó KHÔNG sở hữu đơn nào qua `statement_id` (đơn vẫn
   * thuộc bản gốc), dòng của nó nằm trong `lines_json`. Dựng payload từ đơn như bản thường sẽ
   * ra một bảng kê RỖNG — và gửi rỗng thì MMP xoá sạch dòng điều chỉnh bên họ. */
  const [kt] = await db.select({
    type: schema.shipHoStatements.type, brand: schema.shipHoStatements.partnerBrandSlug,
    periodStart: schema.shipHoStatements.periodStart, periodEnd: schema.shipHoStatements.periodEnd,
    lines: schema.shipHoStatements.linesJson, sua: schema.shipHoStatements.adjustsStatementId,
  }).from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!kt) return null;
  if (kt.type === 'adjustment') {
    if (!kt.sua) { console.warn(`[statement-push] kê điều chỉnh ${id} thiếu adjustsStatementId — KHÔNG gửi`); return null; }
    const dongDc = docDongDieuChinh(kt.lines);
    if (dongDc == null || dongDc.length === 0) {
      console.warn(`[statement-push] kê điều chỉnh ${id} không có dòng nào — KHÔNG gửi`);
      return null;
    }
    return banSuKienBangKe(id, kt.brand, 'statement.issued', payloadStatementAdjustment(
      { id, periodStart: String(kt.periodStart), periodEnd: String(kt.periodEnd), partnerBrandSlug: kt.brand },
      kt.sua, dongDc,
    ));
  }

  const data = await getShipHoStatement(id);
  if (!data) return null;
  const dong: DongBangKeMmp[] = [];
  /* Nạp khoản phí CẢ LÔ một lượt trước vòng lặp — hỏi từng đơn là một lượt đi CSDL mỗi dòng. */
  const phi = await khoanPhiChoBangKe(data.orders.map((x) => (x as { code: string }).code), data.statement.type as LoaiBangKe);
  for (const o of data.orders) {
    const r = o as { code: string; mmpRef: string | null; brandReference: string | null;
      trackingNumber: string | null; shippedAt: string | null; pickedUpAt: Date | null;
      giaThuVnd: number | null; billNumber?: string | null; issueDate?: string | null };
    // Đơn đã vào kê (statementId/dutyStatementId gán ở generateStatement) LẼ RA luôn có giaThuVnd
    // — null ở đây là bất thường (dữ liệu đổi giữa lúc gom kê và lúc gửi); bỏ khỏi payload MMP
    // thay vì báo lệch giả bằng 0, chỉ log cảnh báo.
    if (r.giaThuVnd == null) {
      console.warn(`[statement-push] bỏ đơn ${r.code} khỏi statement.issued ${id}: giaThuVnd null`);
      continue;
    }
    /* NGÀY ĐI HÀNG, không phải ngày tạo nhãn: brand đối chiếu %xăng dầu theo tuần của ngày
     * này. Kèm nguồn để kế toán MMP biết dòng nào có mốc hãng xác nhận. */
    const ngay = ngayDiHang(r);
    /* Dòng MIỄN THU: phí thật vẫn gửi đủ, cộng thêm một khoản `waived` âm để `Σ fees =
     * amountVnd` — ràng buộc MMP giữ nguyên và sẽ trả 422 nếu lệch. Xem `canBangMienThu`. */
    const p0 = phi.get(r.code);
    const p = p0 ? { ...p0, ...canBangMienThu(p0.fees, p0.feesTotalVnd, r.giaThuVnd) } : undefined;
    dong.push({
      code: r.code, mmpRef: r.mmpRef, brandReference: r.brandReference, trackingNumber: r.trackingNumber,
      shippedAt: ngay.ngay, nguonNgayDi: ngay.nguon, amountVnd: r.giaThuVnd,
      ...(p ?? {}),
      ...(data.statement.type === 'duty' ? { fedexInvoiceNumber: r.billNumber ?? null, invoiceDate: r.issueDate ?? null } : {}),
    });
  }
  const payload = payloadStatementIssued(
    { ...data.statement, type: data.statement.type as LoaiBangKe }, dong,
  ) as unknown as Record<string, unknown>;

  /* GHI ẢNH CHỤP TỪNG DÒNG, và ghi MỘT LẦN DUY NHẤT (`lines_json IS NULL`).
   *
   * Đây là bản ghi duy nhất chứng minh đã gửi brand số bao nhiêu, và là đầu vào để tính điều
   * chỉnh về sau. Cho lượt GỬI LẠI ghi đè nó là xoá mất chính cái mốc mà điều chỉnh so với:
   * sau khi ghi đè thì hiệu luôn bằng 0 và mọi chênh lệch biến mất không dấu vết. */
  await db.update(schema.shipHoStatements)
    .set({ linesJson: payload })
    .where(and(eq(schema.shipHoStatements.id, id), isNull(schema.shipHoStatements.linesJson)));

  return banSuKienBangKe(id, data.statement.partnerBrandSlug, 'statement.issued', payload);
}

/**
 * LÕI KHÔNG-AUTH: phát hành một bảng kê — đổi `draft` → `issued` rồi bắn bản đối soát sang MMP
 * qua outbox. Dùng chung bởi server action `setStatementStatus` (nút Gửi) và script chốt kỳ
 * (CEO 01/10/2026 cho phép chạy bằng script cho ca kỳ 09).
 *
 * MỌI hàng rào nằm ở đây, không ở lớp action — để đường script không đi tắt qua chúng:
 *   1. đã `issued` thì KHÔNG bắn lại (giữ đúng một ảnh chụp bên MMP);
 *   2. kê cước còn đơn chưa chốt giá → chặn (đơn có thể rơi về `pending_review`/`claiming` hoặc
 *      mất `actual_charged_vnd` SAU khi gán vào kê mà chưa ai bấm Tính lại; phát hành lúc đó là
 *      gửi thiếu tiền mà bảng kê vẫn coi như gửi đủ — N2, review 21/09/2026);
 *   3. phép chiếu chéo mục (e): có đơn mà luật gán kỳ KHÔNG đặt vào kỳ này → chặn. Phát hành
 *      một kỳ như thế là gửi brand con số mà MMP tính ra kỳ khác, rồi phải xuất hoá đơn điều
 *      chỉnh cho một chuyện lẽ ra chặn được trước khi bấm.
 *
 * Lượt bắn MMP là best-effort: hỏng KHÔNG lùi trạng thái (CEO 21/09/2026) — nhưng từ 01/10 nó
 * có dòng outbox nên cron tự thử lại và sau này còn tra được, thay vì mất cùng dòng thông báo.
 */

/**
 * Nạp dữ liệu rồi chạy cổng rà soát cho một bảng kê.
 *
 * Tách khỏi `phatHanhBangKe` để script `soi-cong-chot-ky.ts` dùng lại y nguyên — cổng chạy thử
 * và cổng chạy thật phải là MỘT, không phải hai bản chép tay. Bản đầu của script nạp bảng tuần
 * xăng dầu chỉ của FedEx và chặn nhầm hai đơn Aramex; lỗi đó sẽ lặp lại nếu có hai bản nạp.
 */
export async function chayCongChotKy(statementId: string): Promise<LoiCong[]> {
  const n = (v: unknown) => Number(v ?? 0);
  // Bảng tuần THEO TỪNG HÃNG: 21/09/2026 FedEx 51,75% còn Aramex 30% phẳng.
  const tuanTheoHang = new Map<string, TuanFuel[]>();
  for (const x of (await db.execute<Record<string, unknown>>(sql`
    SELECT s.carrier_account_id acc, s.starts_at::date tu, s.ends_at::date den, s.value::numeric pct
    FROM carrier_surcharges s
    WHERE s.kind = 'fuel_percent' AND s.starts_at IS NOT NULL ORDER BY s.starts_at;`)).rows) {
    const k = String(x.acc);
    const ds = tuanTheoHang.get(k) ?? [];
    ds.push({ tu: String(x.tu), den: x.den ? String(x.den) : null, pct: n(x.pct) });
    tuanTheoHang.set(k, ds);
  }
  const don = (await db.execute<Record<string, unknown>>(sql`
    SELECT o.code, ca.name hang, o.carrier_account_id acc, o.picked_up_at,
           o.shipped_at::date gui, o.actual_bill_breakdown ab
    FROM ship_ho_orders o LEFT JOIN carrier_accounts ca ON ca.id = o.carrier_account_id
    WHERE o.statement_id = ${statementId};`)).rows
    .map((x): DonKiemCong => {
      const ab = x.ab as Record<string, unknown> | null;
      return {
        code: String(x.code), tenHang: x.hang == null ? null : String(x.hang),
        carrierAccountId: x.acc == null ? null : String(x.acc),
        pickedUpAt: x.picked_up_at as Date | null, shippedAt: x.gui == null ? null : String(x.gui),
        bill: ab == null ? null : {
          base: n(ab.base), discount: n(ab.discount), remote: n(ab.remote), demand: n(ab.demand),
          signature: n(ab.signature), residential: n(ab.residential),
          addressCorrection: n(ab.addressCorrection), additionalHandling: n(ab.additionalHandling),
          fuel: n(ab.fuel),
        },
      };
    });
  return kiemCongChotKy(don, tuanTheoHang);
}

export async function phatHanhBangKe(id: string): Promise<{
  ok: boolean; error?: string; mmp?: { ok: boolean; detail: string };
}> {
  const [ht] = await db.select({
    status: schema.shipHoStatements.status, type: schema.shipHoStatements.type,
    brand: schema.shipHoStatements.partnerBrandSlug,
  }).from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!ht) return { ok: false, error: 'Không tìm thấy bảng kê' };
  if (ht.status !== 'draft') return { ok: false, error: `Bảng kê đã ${ht.status === 'paid' ? 'thu' : 'phát hành'} — không phát hành lại` };

  if (ht.type === 'freight') {
    const dangKe = await db.select({
      actualChargedVnd: schema.shipHoOrders.actualChargedVnd,
      reconcileStatus: schema.shipHoOrders.reconcileStatus,
      reconcileDecision: schema.shipHoOrders.reconcileDecision,
    }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id));
    const chuaChot = dangKe.filter((o) => giaThuBangKe(o) == null).length;
    if (chuaChot > 0) return { ok: false, error: `Bảng kê còn ${chuaChot} đơn chưa chốt — bấm Tính lại trước` };
  }

  const lech = await donLechKy(id);
  if (lech.length > 0) {
    return { ok: false, error: `Bảng kê có ${lech.length} đơn mốc kỳ nằm ngoài kỳ này: ${lech.slice(0, 8).join(', ')}${lech.length > 8 ? '…' : ''} — chạy lại lệnh gom để xếp đúng kỳ trước khi phát hành` };
  }

  /* Cổng rà soát (CEO 03/10/2026): ngày đi hàng và %xăng dầu phải khớp TRƯỚC khi kỳ rời khỏi
   * trạng thái nháp. Trước đó kỳ phát hành mà không có phép kiểm nào về hai thứ này, và một
   * con số sai (52,65% ở #KLS1998) đã kịp ra tới bảng gửi brand. */
  const congLoi = await chayCongChotKy(id);
  if (congLoi.length > 0) {
    const vd = congLoi.slice(0, 5).map((l) => `${l.code}: ${l.ly}`).join(' · ');
    return { ok: false,
      error: `Cổng rà soát chặn ${congLoi.length} đơn — ${vd}${congLoi.length > 5 ? ` · còn ${congLoi.length - 5} đơn` : ''}` };
  }

  await db.update(schema.shipHoStatements)
    .set({ status: 'issued', issuedAt: new Date() })
    .where(eq(schema.shipHoStatements.id, id));
  const mmp = (await banBangKeSangMmp(id)) ?? undefined;
  /* Sheet đi SAU và ĐỘC LẬP: MMP là hợp đồng, sheet là bản tiện đọc. Sheet hỏng không được làm
   * hỏng việc kỳ đã phát hành — nên nó đi qua outbox và cron thử lại, y như lượt gửi MMP. */
  await banSuKienBangKe(id, ht.brand, 'statement.sheet', { statementId: id });

  return { ok: true, mmp };
}

export interface KetQuaGomDieuChinh {
  brand: string; keGoc: string; kyGoc: string;
  /** Kỳ mà bản điều chỉnh được phát hành vào. */
  kyDieuChinh?: string;
  soDong: number; tongDelta: number;
  viec: 'khong_co_hieu' | 'thieu_anh_chup' | 'khong_con_ky_mo' | 'tao_moi' | 'cap_nhat';
  statementId?: string;
}

/**
 * Gom DÒNG ĐIỀU CHỈNH cho một bảng kê ĐÃ PHÁT HÀNH: so ảnh chụp lúc phát hành với giá hiện tại
 * của chính các đơn trong kê, rồi dựng/cập nhật một bảng kê `adjustment` NHÁP ở kỳ đang mở.
 *
 * KHÔNG mở lại kỳ cũ (CEO + MMP thống nhất 01/10/2026): số đã gửi brand phải đứng yên, chênh
 * lệch đi đường điều chỉnh. Bản điều chỉnh KHÔNG sở hữu đơn nào — đơn vẫn thuộc bản gốc; nếu
 * gán lại `statement_id` thì bản gốc rỗng dần và không còn gì để so ảnh chụp.
 *
 * `thieu_anh_chup`: bảng kê phát hành TRƯỚC migration 0190 (ba bản Kalisa 07/08 nhập từ MMP)
 * không có `lines_json`, nên không tính được hiệu. Báo RIÊNG thay vì coi là "không có hiệu" —
 * hai chuyện đó khác nhau, và gộp lại là báo an toàn giả.
 */
export async function goDieuChinh(keGocId: string, now: Date = new Date()): Promise<KetQuaGomDieuChinh> {
  const [goc] = await db.select({
    id: schema.shipHoStatements.id, brand: schema.shipHoStatements.partnerBrandSlug,
    type: schema.shipHoStatements.type, status: schema.shipHoStatements.status,
    periodStart: schema.shipHoStatements.periodStart, lines: schema.shipHoStatements.linesJson,
  }).from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, keGocId)).limit(1);
  if (!goc) throw new Error(`[dieu-chinh] không thấy bảng kê ${keGocId}`);
  const kyGoc = String(goc.periodStart).slice(0, 7);
  const chung = { brand: goc.brand, keGoc: keGocId, kyGoc };
  if (goc.status === 'draft' || goc.type === 'adjustment') {
    return { ...chung, soDong: 0, tongDelta: 0, viec: 'khong_co_hieu' };
  }

  const anhChup = docAnhChup(goc.lines);
  if (anhChup == null) return { ...chung, soDong: 0, tongDelta: 0, viec: 'thieu_anh_chup' };

  const cot = goc.type === 'duty' ? schema.shipHoOrders.dutyStatementId : schema.shipHoOrders.statementId;
  const donRows = await db.select({
    code: schema.shipHoOrders.code,
    cuoc: schema.shipHoOrders.actualChargedVnd, bao: schema.shipHoOrders.chargedVnd,
    duty: schema.shipHoOrders.actualDutyVnd,
  }).from(schema.shipHoOrders).where(eq(cot, keGocId));
  const hienTai = donRows.map((o) => ({
    code: o.code,
    amountVnd: Number(goc.type === 'duty' ? (o.duty ?? 0) : (o.cuoc ?? o.bao ?? 0)),
  }));

  const hieu = tinhDongDieuChinh(anhChup, hienTai);
  if (hieu.dong.length === 0) return { ...chung, soDong: 0, tongDelta: 0, viec: 'khong_co_hieu' };

  // Bản điều chỉnh phát hành vào KỲ ĐANG MỞ SỚM NHẤT của brand, tính từ kỳ gốc — cùng phép
  // `chonKyGom` mà luật gán kỳ dùng, nên hai bên không lệch cách xử lý.
  const keCu = await db.select({
    periodStart: schema.shipHoStatements.periodStart, status: schema.shipHoStatements.status,
  }).from(schema.shipHoStatements).where(and(
    eq(schema.shipHoStatements.partnerBrandSlug, goc.brand),
    eq(schema.shipHoStatements.type, 'adjustment'),
  ));
  const theoKy = new Map(keCu.map((k) => [String(k.periodStart).slice(0, 7), k.status]));
  const chon = chonKyGom({ tenMoc: kyGoc, tenHienTai: kyThang(now).ten, trangThai: (t) => theoKy.get(t) ?? null });
  if (chon.ten == null) return { ...chung, soDong: hieu.dong.length, tongDelta: hieu.tongDelta, viec: 'khong_con_ky_mo' };
  const ky = kyTuTen(chon.ten);

  const [daCo] = await db.select({ id: schema.shipHoStatements.id })
    .from(schema.shipHoStatements).where(and(
      eq(schema.shipHoStatements.adjustsStatementId, keGocId),
      eq(schema.shipHoStatements.status, 'draft'),
    )).limit(1);

  const giaTri = {
    orderCount: hieu.dong.length, totalChargedVnd: String(Math.round(hieu.tongDelta)),
    linesJson: { dong: hieu.dong, tongDelta: hieu.tongDelta },
  };
  if (daCo) {
    await db.update(schema.shipHoStatements).set(giaTri).where(eq(schema.shipHoStatements.id, daCo.id));
    return { ...chung, kyDieuChinh: chon.ten, soDong: hieu.dong.length, tongDelta: hieu.tongDelta, viec: 'cap_nhat', statementId: daCo.id };
  }
  const [moi] = await db.insert(schema.shipHoStatements).values({
    partnerBrandSlug: goc.brand, type: 'adjustment', status: 'draft',
    periodStart: ky.dau, periodEnd: ky.cuoi, adjustsStatementId: keGocId, ...giaTri,
  }).returning({ id: schema.shipHoStatements.id });
  return { ...chung, kyDieuChinh: chon.ten, soDong: hieu.dong.length, tongDelta: hieu.tongDelta, viec: 'tao_moi', statementId: moi!.id };
}

/** Gom điều chỉnh cho MỌI bảng kê đã phát hành. Dùng bởi cron và script. */
export async function goDieuChinhTatCa(now: Date = new Date()): Promise<KetQuaGomDieuChinh[]> {
  const ds = await db.select({ id: schema.shipHoStatements.id })
    .from(schema.shipHoStatements)
    .where(and(
      inArray(schema.shipHoStatements.status, ['issued', 'paid']),
      inArray(schema.shipHoStatements.type, ['freight', 'duty']),
    ));
  const ra: KetQuaGomDieuChinh[] = [];
  for (const k of ds) ra.push(await goDieuChinh(k.id, now));
  return ra;
}

