import { larkText } from './parse-pack-row';

/** Tên cột bảng Lark "WH ngày MEAN nhận hàng". Đổi tên cột bên Lark là hỏng — để MỘT chỗ. */
export const COT_SO_DON = 'order_number';
export const COT_SKU = 'Lineitem SKU';
export const COT_VENDOR = 'vendor';
export const COT_NGAY_NHAN = 'Visible - WH-Ngày MEAN nhận hàng gần nhất';
/** Cột MỚI do ops tạo (kiểu Text) — spec §5.2. Chưa có cột này thì Lark trả lỗi field không tồn tại → rơi vào `loi`. */
export const COT_MA_MON = 'Mã món';

export interface DongNhanHang {
  orderNumber: string; sku: string; vendor: string | null; receivedAt: Date;
  /** Mã WH- các món đã xác nhận của dòng. */
  maMon: string[];
}

export function dungFieldsNhanHang(d: DongNhanHang): Record<string, unknown> {
  return {
    [COT_SO_DON]: d.orderNumber.trim().replace(/^#/, ''),
    [COT_SKU]: d.sku,
    [COT_VENDOR]: d.vendor,
    [COT_NGAY_NHAN]: d.receivedAt.getTime(),
    [COT_MA_MON]: d.maMon.join(' | '),
  };
}

export interface KetQuaDongBoNhanHang {
  /** Dòng SMS đem đi đối chiếu. */
  doiChieu: number;
  /** Lark chưa có → tạo mới. */
  daTao: number;
  /** Lark đã có, ô Mã món trống → điền. */
  daDien: number;
  /** Lark đã có Mã món → bỏ qua, KHÔNG ghi đè (ops có thể đã sửa tay). */
  boQua: number;
  loi: string[];
}

function khoa(orderNumber: string | null, sku: string | null): string | null {
  const so = orderNumber?.trim().replace(/^#/, '');
  const s = sku?.trim();
  return so && s ? `${so} ${s}` : null;
}

/**
 * Đẩy "MEAN đã nhận" từ SMS lên bảng Lark, cùng luật với cột Couriers (D-045):
 * tạo khi chưa có, CHỈ ĐIỀN Ô TRỐNG khi đã có, không ghi đè giá trị người đã ghi.
 * Hàm tiêm để test thuần; KHÔNG ném lỗi ra ngoài — kho đã quét xong rồi, Lark
 * hỏng thì cron điền bù, không được làm hỏng thao tác nhận.
 */
export async function dongBoNhanHangLark(
  dongs: DongNhanHang[],
  docRecords: () => Promise<Array<{ record_id: string; fields: Record<string, unknown> }>>,
  taoRecord: (fields: Record<string, unknown>) => Promise<string>,
  capNhat: (recordId: string, fields: Record<string, unknown>) => Promise<void>,
): Promise<KetQuaDongBoNhanHang> {
  const kq: KetQuaDongBoNhanHang = { doiChieu: dongs.length, daTao: 0, daDien: 0, boQua: 0, loi: [] };
  if (dongs.length === 0) return kq;
  const recs = await docRecords();
  const theoKhoa = new Map<string, Array<{ record_id: string; fields: Record<string, unknown> }>>();
  for (const r of recs) {
    const k = khoa(larkText(r.fields[COT_SO_DON]), larkText(r.fields[COT_SKU]));
    if (!k) continue;
    const arr = theoKhoa.get(k) ?? [];
    arr.push(r); theoKhoa.set(k, arr);
  }
  for (const d of dongs) {
    const k = khoa(d.orderNumber, d.sku)!;
    const nhan = `${k}`;
    try {
      const co = theoKhoa.get(k);
      if (!co || co.length === 0) { await taoRecord(dungFieldsNhanHang(d)); kq.daTao += 1; continue; }
      for (const r of co) {
        const hienTai = larkText(r.fields[COT_MA_MON]);
        if (hienTai && hienTai.trim() !== '') { kq.boQua += 1; continue; }
        await capNhat(r.record_id, { [COT_MA_MON]: d.maMon.join(' | ') });
        kq.daDien += 1;
      }
    } catch (e) {
      kq.loi.push(`${nhan}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return kq;
}
