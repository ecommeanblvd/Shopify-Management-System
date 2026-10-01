/**
 * Lõi không-auth cho bảng kê ship hộ: tính lại tổng một bảng kê còn NHÁP theo LOẠI —
 * cước (freight) chỉ tính giá thực đã chốt đối soát; duty tính theo actual_duty_vnd
 * của các đơn đã gán vào kê (CEO 21/09/2026, thay luật 08/09).
 * Dùng bởi server action (nút "Tính lại tổng") và script bảo trì. Bảng kê đã
 * issued/paid KHÔNG tính lại — số đã gửi brand phải đứng yên.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { chiaDonTrongKe, summarizeStatement, QUYET_DINH_DA_CHOT } from './statement-logic';
import type { LoaiBangKe } from './statement-logic';
import { kyThang, viecGom, kyTuTen, chonKyGom, type LyDoKy } from './ky-bang-ke';
import { giaThuBangKe } from './statement-logic';
import { getShipHoStatement } from './statement-queries';
import { payloadStatementIssued, type DongBangKeMmp } from './statement-push';
import { banSuKienBangKe } from './statement-outbox';
import { khoanPhiChoBangKe } from './bang-ke-khoan-phi-queries';

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
  const data = await getShipHoStatement(id);
  if (!data) return null;
  const dong: DongBangKeMmp[] = [];
  /* Nạp khoản phí CẢ LÔ một lượt trước vòng lặp — hỏi từng đơn là một lượt đi CSDL mỗi dòng. */
  const phi = await khoanPhiChoBangKe(data.orders.map((x) => (x as { code: string }).code), data.statement.type);
  for (const o of data.orders) {
    const r = o as { code: string; mmpRef: string | null; brandReference: string | null; trackingNumber: string | null; shippedAt: string | null; giaThuVnd: number | null; billNumber?: string | null; issueDate?: string | null };
    // Đơn đã vào kê (statementId/dutyStatementId gán ở generateStatement) LẼ RA luôn có giaThuVnd
    // — null ở đây là bất thường (dữ liệu đổi giữa lúc gom kê và lúc gửi); bỏ khỏi payload MMP
    // thay vì báo lệch giả bằng 0, chỉ log cảnh báo.
    if (r.giaThuVnd == null) {
      console.warn(`[statement-push] bỏ đơn ${r.code} khỏi statement.issued ${id}: giaThuVnd null`);
      continue;
    }
    dong.push({
      code: r.code, mmpRef: r.mmpRef, brandReference: r.brandReference, trackingNumber: r.trackingNumber,
      shippedAt: r.shippedAt, amountVnd: r.giaThuVnd,
      ...(phi.get(r.code) ?? {}),
      ...(data.statement.type === 'duty' ? { fedexInvoiceNumber: r.billNumber ?? null, invoiceDate: r.issueDate ?? null } : {}),
    });
  }
  return banSuKienBangKe(
    id, data.statement.partnerBrandSlug, 'statement.issued',
    payloadStatementIssued(data.statement, dong) as unknown as Record<string, unknown>,
  );
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
export async function phatHanhBangKe(id: string): Promise<{
  ok: boolean; error?: string; mmp?: { ok: boolean; detail: string };
}> {
  const [ht] = await db.select({ status: schema.shipHoStatements.status, type: schema.shipHoStatements.type })
    .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
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

  await db.update(schema.shipHoStatements)
    .set({ status: 'issued', issuedAt: new Date() })
    .where(eq(schema.shipHoStatements.id, id));
  const mmp = (await banBangKeSangMmp(id)) ?? undefined;
  return { ok: true, mmp };
}
