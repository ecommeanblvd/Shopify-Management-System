'use server';

/**
 * Nhập credit note carrier từ chính email hoá đơn điện tử (.msg) hoặc từ file rời (.xml/.zip/.csv).
 *
 * Vì sao đọc .msg: một email DHL chứa đủ 4 thứ — thân thư, PDF, XML hoá đơn điện tử (số/ngày/tiền máy đọc được) và CSV
 * chi tiết từng kiện. Đọc thẳng .msg thì không phải giải nén tay và không sai số do đọc chữ từ PDF.
 *
 * Quy tắc tiền (CEO 10/09/2026): TIỀN lấy "Tổng cộng tiền thanh toán" trên hoá đơn VAT (XML), cộng theo NGÀY HOÁ ĐƠN.
 * CSV chỉ dùng để biết đợt điều chỉnh đụng tới những kiện/đơn nào — một đợt có thể trải trên nhiều hoá đơn VAT nên
 * KHÔNG cộng tiền từ CSV.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { bocTep } from './boc-tep';
import { docHoaDonXml, maThamChieu, type HoaDonDienTu } from './hoa-don-xml';
import { parseDhlInvoiceCsv, tachTheoHoaDon, type DhlShipment } from './dhl-invoice-csv';

export interface KetQuaNhapCreditNote {
  tenFile: string;
  /** Hoá đơn đọc được; null khi file không chứa hoá đơn điện tử. */
  hoaDon: HoaDonDienTu | null;
  /** Đã có sẵn trong hệ thống (nhập lại thì cập nhật, không tạo trùng). */
  daCo: boolean;
  soDongChiTiet: number;
  soDongKhopKien: number;
  canhBao: string[];
}

/** Nhập một tệp credit note. Trả kết quả để UI báo rõ đã ghi gì. */
export async function nhapCreditNote(tenFile: string, base64: string): Promise<KetQuaNhapCreditNote> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('Chưa đăng nhập');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_shipping_invoices')) throw new Error('Không có quyền nhập credit note');

  const files = bocTep(tenFile, Buffer.from(base64, 'base64'));
  const canhBao: string[] = [];

  // 1) Hoá đơn điện tử (XML) — nguồn TIỀN và NGÀY.
  let hoaDon: HoaDonDienTu | null = null;
  for (const [ten, buf] of files) {
    if (!/\.xml$/i.test(ten)) continue;
    const h = docHoaDonXml(buf.toString('utf8'));
    if (h) { hoaDon = h; break; }
  }
  if (!hoaDon) {
    return { tenFile, hoaDon: null, daCo: false, soDongChiTiet: 0, soDongKhopKien: 0,
      canhBao: ['Không tìm thấy hoá đơn điện tử (.xml) trong tệp — gửi nguyên email .msg hoặc file zip hoá đơn.'] };
  }
  if (hoaDon.tongCong > 0) canhBao.push('Hoá đơn mang số DƯƠNG — đây là hoá đơn thu tiền, không phải credit note.');

  // 2) Chi tiết từng kiện (CSV) — chỉ để truy đơn, không cộng tiền.
  const chiTiet: DhlShipment[] = [];
  let maHoaDonCsv: string[] = [];
  for (const [ten, buf] of files) {
    if (!/\.csv$/i.test(ten)) continue;
    for (const khoi of tachTheoHoaDon(buf.toString('utf8'))) {
      const r = parseDhlInvoiceCsv(khoi);
      if (!r) continue;
      maHoaDonCsv.push(r.billNumber);
      chiTiet.push(...r.shipments);
    }
  }
  maHoaDonCsv = [...new Set(maHoaDonCsv)];

  // 3) Khớp kiện theo mã vận đơn.
  const tracking = [...new Set(chiTiet.map((s) => s.shipmentNumber).filter(Boolean))];
  const kien = tracking.length
    ? await db.select({ id: schema.shipments.id, tracking: schema.shipments.trackingNumber })
        .from(schema.shipments).where(inArray(schema.shipments.trackingNumber, tracking))
    : [];
  const theoTracking = new Map(kien.map((k) => [k.tracking ?? '', k.id]));

  const carrierKey = /dhl/i.test(hoaDon.benBan) ? 'dhl' : /fedex/i.test(hoaDon.benBan) ? 'fedex' : null;
  const gt = {
    ngay: hoaDon.ngay,
    carrierKey,
    truocThue: String(hoaDon.truocThue),
    tienThue: String(hoaDon.tienThue),
    tongCong: String(hoaDon.tongCong),
    maThamChieu: [...new Set([...maThamChieu(hoaDon.noiDung), ...maHoaDonCsv])],
    noiDung: hoaDon.noiDung.slice(0, 2000),
    tenFile,
    importedBy: session.user.id,
    importedAt: new Date(),
  };

  const [cu] = await db.select({ id: schema.creditNotes.id }).from(schema.creditNotes)
    .where(and(eq(schema.creditNotes.kyHieu, hoaDon.kyHieu), eq(schema.creditNotes.soHoaDon, hoaDon.soHoaDon)));

  const [ghi] = cu
    ? await db.update(schema.creditNotes).set(gt).where(eq(schema.creditNotes.id, cu.id)).returning({ id: schema.creditNotes.id })
    : await db.insert(schema.creditNotes).values({ soHoaDon: hoaDon.soHoaDon, kyHieu: hoaDon.kyHieu, ...gt })
        .returning({ id: schema.creditNotes.id });

  // Ghi lại chi tiết: xoá cũ rồi chèn mới để nhập lại không nhân đôi.
  await db.delete(schema.creditNoteLines).where(eq(schema.creditNoteLines.creditNoteId, ghi.id));
  let khop = 0;
  if (chiTiet.length) {
    const rows = chiTiet.map((s) => {
      const shipmentId = theoTracking.get(s.shipmentNumber) ?? null;
      if (shipmentId) khop += 1;
      return {
        creditNoteId: ghi.id,
        trackingNumber: s.shipmentNumber || null,
        orderNumber: s.orderRef || null,
        shipmentId,
        originalInvoice: null as string | null,
        invoiceNumber: null as string | null,
        shipDate: /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : null,
        weightKg: String(s.weightKg),
        totalInclVat: String(s.totalInclVat),
      };
    });
    for (let i = 0; i < rows.length; i += 500) await db.insert(schema.creditNoteLines).values(rows.slice(i, i + 500));
  } else {
    canhBao.push('Không có file CSV chi tiết — vẫn ghi được tiền và ngày, nhưng không truy được đơn nào liên quan.');
  }
  if (chiTiet.length && khop === 0) canhBao.push('Không khớp được kiện nào theo mã vận đơn — kiểm tra lại dữ liệu shipments.');

  revalidatePath('/f/shipping-reconcile');
  revalidatePath('/f/ship-report');
  return { tenFile, hoaDon, daCo: !!cu, soDongChiTiet: chiTiet.length, soDongKhopKien: khop, canhBao };
}
