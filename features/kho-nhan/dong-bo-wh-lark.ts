/**
 * Kéo bảng Lark "WH - Inventory" về bản sao `lark_wh_inventory`.
 *
 * CỐ Ý KHÔNG có `'use server'` — đây là việc của cron và của nút bấm trong
 * server action, không phải endpoint cho trình duyệt gọi thẳng.
 *
 * CHỈ ĐỌC từ Lark. Không ghi lại bên đó dù chỉ một ký tự.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { listAllWhInventoryRecords, type LarkRecord } from '@/features/lark/client';
import { MUI_GIO_KINH_DOANH } from '@/lib/timezone';

function chuoi(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    const s = v.map((x) => (typeof x === 'string' ? x
      : typeof x === 'number' ? String(x)
      : (x as { text?: string; name?: string })?.text ?? (x as { name?: string })?.name ?? '')).join('');
    return s.trim() || null;
  }
  if (typeof v === 'object') return (v as { text?: string }).text?.trim() || null;
  return null;
}

function so(v: unknown): number | null {
  const s = chuoi(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function coFile(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

/** [{file_token,name,…}] của Lark → dạng gọn mình lưu. */
function dsFile(v: unknown): { token: string; ten: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const f = x as { file_token?: string; name?: string };
      return { token: f.file_token ?? '', ten: f.name ?? '' };
    })
    .filter((x) => x.token !== '');
}

/** Mốc ms của Lark → ngày NGHIỆP VỤ 'YYYY-MM-DD'. */
function ngay(v: unknown): string | null {
  if (typeof v !== 'number') return null;
  return new Date(v).toLocaleDateString('en-CA', { timeZone: MUI_GIO_KINH_DOANH });
}

export function dungDongMirror(r: LarkRecord) {
  const f = r.fields;
  return {
    recordId: r.record_id,
    ngayImport: ngay(f['Ngày Import - tiếp nhận đồ tại kho']),
    dinhDanh: chuoi(f['Định danh']),
    warehouse: chuoi(f['Warehouse']),
    inventoryType: chuoi(f['Import - Inventory type']),
    // Ưu tiên cột TAY; trống thì lấy cột look up — dòng cũ có thể chỉ có một trong hai.
    orderNumber: chuoi(f['Order Number final']) ?? chuoi(f['Order number (look up)']),
    sku: chuoi(f['Lineitem SKU final']) ?? chuoi(f['Lineitem SKU (look up)']),
    lineitemName: chuoi(f['Lineitem Name']) ?? chuoi(f['Lineitem Name (look up)']),
    storeFinal: chuoi(f['Store final']),
    vendorFinal: chuoi(f['Vendor final']),
    qcCheck: chuoi(f['QC Check']),
    whAction: chuoi(f['WH - Action']),
    uniqueCode: chuoi(f['WH - Unique code (k xóa)']),
    soLuong: so(f['Quantity tiếp nhận trước QC']) ?? so(f['Quantity (look up)']),
    coAnhHangDen: coFile(f['Ảnh Thực Tế SP']),
    coBbBanGiao: coFile(f['BB Giao Nhận']),
    anhHangDen: dsFile(f['Ảnh Thực Tế SP']),
    bbBanGiao: dsFile(f['BB Giao Nhận']),
    capNhatLuc: new Date(),
  };
}

export interface KetQuaDongBo { doc: number; ghi: number; xoa: number }

export async function dongBoWhInventory(): Promise<KetQuaDongBo> {
  const tho = await listAllWhInventoryRecords();
  const dong = tho.map(dungDongMirror);

  // Chia lô 500: một câu insert 9.000 dòng vượt trần tham số của Postgres.
  let ghi = 0;
  for (let i = 0; i < dong.length; i += 500) {
    const lo = dong.slice(i, i + 500);
    await db.insert(schema.larkWhInventory).values(lo).onConflictDoUpdate({
      target: schema.larkWhInventory.recordId,
      set: {
        ngayImport: sql`excluded.ngay_import`, dinhDanh: sql`excluded.dinh_danh`,
        warehouse: sql`excluded.warehouse`, inventoryType: sql`excluded.inventory_type`,
        orderNumber: sql`excluded.order_number`, sku: sql`excluded.sku`,
        lineitemName: sql`excluded.lineitem_name`, storeFinal: sql`excluded.store_final`,
        vendorFinal: sql`excluded.vendor_final`, qcCheck: sql`excluded.qc_check`,
        whAction: sql`excluded.wh_action`, uniqueCode: sql`excluded.unique_code`,
        soLuong: sql`excluded.so_luong`, coAnhHangDen: sql`excluded.co_anh_hang_den`,
        coBbBanGiao: sql`excluded.co_bb_ban_giao`,
        anhHangDen: sql`excluded.anh_hang_den`, bbBanGiao: sql`excluded.bb_ban_giao`,
        capNhatLuc: sql`excluded.cap_nhat_luc`,
      },
    });
    ghi += lo.length;
  }

  /* Dòng đội kho xoá bên Lark phải biến mất khỏi bản sao, nếu không trang hiện
   * mãi một dòng không còn tồn tại. Chỉ dọn khi lượt kéo có dữ liệu — Lark trả
   * rỗng vì lỗi mạng mà đem đi xoá là mất sạch bản sao. */
  let xoa = 0;
  if (dong.length > 0) {
    const r = await db.execute(sql`
      DELETE FROM lark_wh_inventory
      WHERE record_id NOT IN (${sql.join(dong.map((d) => sql`${d.recordId}`), sql`, `)})`);
    xoa = r.rowCount ?? 0;
  }

  return { doc: tho.length, ghi, xoa };
}
