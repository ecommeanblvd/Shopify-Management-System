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
 * Phép CHIẾU CHÉO (mục (e) đề xuất chốt kỳ, CEO 01/10/2026): đơn trong bảng kê có mốc kỳ nằm
 * NGOÀI cửa sổ kỳ của chính bảng kê đó.
 *
 * ÁP CHO CẢ `freight` VÀ `duty`, vì cả hai cùng một mốc: ngày đẩy sự kiện tương ứng
 * (`order.reconciled` / `order.duty_charged`).
 *
 * Tưởng là hai luật mâu thuẫn, hoá ra KHÔNG (CEO hỏi 01/10/2026, truy ra): `shipHoStatements`
 * và `statement-actions` còn ghi "kỳ duty theo ngày hoá đơn FedEx" — đó là văn bản của quyết
 * định 21/09, bị quyết định 22/09 thay (ngày đẩy) mà KHÔNG AI XOÁ. Đo 01/10: bản duty kỳ 08
 * (phát hành dưới luật cũ) có tháng hoá đơn 07/08 nhưng tháng đẩy 09 cho cả 23 đơn; bản kỳ 09
 * và sau đó khớp ngày đẩy 100%. Hai bình luận cũ đã sửa cùng vòng này.
 *
 * Ngày hoá đơn FedEx VẪN có việc riêng, chỉ không phải việc chia kỳ: nó in trên từng dòng bảng
 * kê để brand tra đúng tờ khai (`statement-queries.ts`).
 *
 * Bản duty kỳ 08 lệch 23/23 là DI SẢN của luật cũ, và không bị phép kiểm này cản: nó đã
 * `issued`, mà đường phát hành chặn bản đã phát hành từ trước đó.
 *
 * CHẶN phát hành, không cảnh báo suông — hai bên đã thống nhất đây là bất biến, mà một cảnh
 * báo không ai đọc thì bằng không có (bài học D-177: 84 sự kiện hỏng nằm đó nhiều tuần).
 *
 * Trả MÃ ĐƠN, không trả số đếm: người bấm phải biết đơn nào để đi xem, chứ "còn 3 đơn lệch kỳ"
 * thì không ai tra được (đúng lỗi em đã gây một vòng lãng phí với MMP — xem D-176).
 */
export async function donLechKy(statementId: string): Promise<string[]> {
  // `${statementId}` đi qua THAM SỐ, không nối chuỗi vào câu lệnh: id tới từ tham số server
  // action, nối tay là mở đường tiêm SQL ngay giữa luồng tiền.
  const r = await db.execute<{ code: string }>(sql`
    SELECT o.code
      FROM ship_ho_statements s
      JOIN ship_ho_orders o
        ON (CASE WHEN s.type = 'duty' THEN o.duty_statement_id ELSE o.statement_id END) = s.id
      LEFT JOIN LATERAL (
        SELECT min(e.occurred_at) AS push_dau FROM ship_ho_order_events e
         WHERE e.order_id = o.id
           AND e.event = CASE WHEN s.type = 'duty' THEN 'order.duty_charged' ELSE 'order.reconciled' END
      ) p ON TRUE
     WHERE s.id = ${statementId}::uuid
       AND (p.push_dau IS NULL OR p.push_dau::date NOT BETWEEN s.period_start AND s.period_end)
     ORDER BY o.code`);
  return r.rows.map((x) => x.code);
}
