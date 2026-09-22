/**
 * Ghi việc nhận + kiểm hàng của kho sang bảng Lark "WH - Inventory".
 *
 * Đường ghi HẸP có chủ đích: chỉ tạo dòng và sửa đúng những cột ở gia-tri-lark.ts, KHÔNG có
 * hàm xoá — một lỗi lập trình không được phép quét sạch bảng vận hành của kho (D-045).
 */
import {
  searchWhInventoryByDon, createWhInventoryRecord, updateWhInventoryRecord, listWhInventoryFields,
  type LarkRecord,
} from './client';
import { larkText } from './parse-pack-row';
import { cotTaoDong, cotCapNhat, type ViecNhanKcs } from '@/features/kho-nhan/gia-tri-lark';

/** THUẦN: trong các dòng kho của một ĐƠN, dòng nào nối tới đúng món này. */
export function timDongTheoMon(recs: readonly LarkRecord[], monRecordId: string): LarkRecord | null {
  for (const r of recs) {
    const v = r.fields['Import (select order)'] as { link_record_ids?: unknown } | undefined;
    const ids = Array.isArray(v?.link_record_ids) ? (v!.link_record_ids as unknown[]) : [];
    if (ids.some((x) => x === monRecordId)) return r;
  }
  return null;
}

/** THUẦN: mã dòng kho của món này (null nếu chưa có dòng nào). */
export function locDongTheoMon(recs: readonly LarkRecord[], monRecordId: string): string | null {
  return timDongTheoMon(recs, monRecordId)?.record_id ?? null;
}

/** Kết quả kho ĐANG có trên một dòng Lark — để màn hình hiện ra trước khi kho ghi đè. */
export interface KetQuaKhoTrenLark {
  recordId: string;
  soLuong: number | null;
  canKg: number | null;
  qcCheck: string | null;
  whAction: string | null;
  lyDoFail: string | null;
}

/** THUẦN: số đọc từ ô Lark (ô có thể là số, chuỗi, hoặc rich-text). */
function larkSo(v: unknown): number | null {
  const s = larkText(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** THUẦN: đọc kết quả kho đang ghi trên một dòng Lark. */
export function docDongKho(r: LarkRecord): KetQuaKhoTrenLark {
  return {
    recordId: r.record_id,
    soLuong: larkSo(r.fields['Quantity tiếp nhận trước QC']),
    canKg: larkSo(r.fields['Weight (kg)']),
    qcCheck: larkText(r.fields['QC Check']),
    whAction: larkText(r.fields['WH - Action']),
    lyDoFail: larkText(r.fields['Lý do QC failed']),
  };
}

/**
 * Cột CHỌN mà giá trị KHÔNG do SMS tự đặt mà bê từ bảng món sang: tên có thể lệch một dấu
 * cách, một chữ hoa là Lark đẻ lựa chọn mới và làm loạn bộ lọc của cả đội. Phải đối chiếu với
 * danh sách lựa chọn thật của bảng kho trước khi gửi (spec §5, cùng nguyên tắc courier-name.ts).
 *
 * QC Check / WH - Action / Warehouse KHÔNG nằm ở đây vì SMS chỉ cho chọn trong hằng số
 * gia-tri-lark.ts, đã khớp sẵn tên Lark.
 */
export const COT_CHON_PHAI_KIEM = ['Store final', 'Vendor final'] as const;

/**
 * THUẦN: bỏ khỏi bộ cột những cột chọn mang giá trị Lark KHÔNG có sẵn.
 * Không biết danh sách lựa chọn (đọc hỏng) cũng bỏ — thà thiếu một cột phụ còn hơn đẻ lựa
 * chọn rác trên bảng vận hành.
 */
export function locCotChon(
  cot: Record<string, unknown>,
  hopLe: ReadonlyMap<string, ReadonlySet<string>>,
): { cot: Record<string, unknown>; boQua: { cot: string; giaTri: string }[] } {
  const ra = { ...cot };
  const boQua: { cot: string; giaTri: string }[] = [];
  for (const ten of COT_CHON_PHAI_KIEM) {
    if (!(ten in ra)) continue;
    const giaTri = String(ra[ten] ?? '');
    if (!hopLe.get(ten)?.has(giaTri)) {
      delete ra[ten];
      boQua.push({ cot: ten, giaTri });
    }
  }
  return { cot: ra, boQua };
}

// Danh sách lựa chọn của bảng kho đổi rất chậm → nhớ trong RAM tiến trình, đọc Lark một lần.
let cacheOption: Map<string, Set<string>> | null = null;
let dangNap: Promise<Map<string, Set<string>>> | null = null;

async function napOption(): Promise<Map<string, Set<string>>> {
  if (cacheOption) return cacheOption;
  // Nhiều món lưu cùng lúc thì vẫn chỉ một lượt gọi Lark.
  dangNap ??= listWhInventoryFields()
    .then((fields) => {
      const m = new Map<string, Set<string>>();
      for (const f of fields) {
        const ds = f.property?.options ?? [];
        if (ds.length) m.set(f.field_name, new Set(ds.map((o) => String(o.name ?? '')).filter(Boolean)));
      }
      cacheOption = m;
      return m;
    })
    .finally(() => { dangNap = null; });
  return dangNap;
}

/**
 * Danh sách lựa chọn hợp lệ của MỘT cột chọn trên bảng kho. Đọc Lark hỏng → trả tập rỗng
 * (không nhớ lại) để lần sau còn thử lại; caller hiểu tập rỗng là "không gửi cột này".
 */
export async function optionHopLe(tenCot: string): Promise<Set<string>> {
  try {
    return (await napOption()).get(tenCot) ?? new Set<string>();
  } catch (e) {
    console.warn('[wh-inventory] không đọc được danh sách lựa chọn của bảng kho:', e);
    return new Set<string>();
  }
}

/** Danh sách lựa chọn của đúng những cột cần kiểm (một lượt gọi Lark nhờ cache dùng chung). */
async function optionCacCotPhaiKiem(): Promise<Map<string, Set<string>>> {
  const cap = await Promise.all(COT_CHON_PHAI_KIEM.map(async (t) => [t, await optionHopLe(t)] as const));
  return new Map(cap);
}

/**
 * Tạo dòng mới hoặc cập nhật dòng có sẵn của món. Tìm theo LIÊN KẾT MÓN (không theo mã đơn —
 * một đơn có nhiều món).
 *
 * Tìm rồi tạo là HAI lượt gọi mạng, tự nó không chống được chạy đua. Chỗ chặn thật nằm ở SMS:
 * bảng wh_nhan_kcs có unique index theo món, nên hai người cùng nhận một món vẫn chỉ ra một
 * dòng việc và một lần đẩy sang đây.
 */
export async function ghiDongKho(v: ViecNhanKcs, ngay: Date = new Date()): Promise<{ larkRecordId: string; tao: boolean }> {
  const dsDon = await searchWhInventoryByDon(v.orderNumber);
  const daCo = v.monRecordId ? timDongTheoMon(dsDon, v.monRecordId) : null;
  if (daCo) {
    // Chỉ XOÁ lý do hỏng khi món thật sự rời khỏi trạng thái không đạt. Xoá vô điều kiện là
    // mỗi lần sửa cân cũng thổi bay lý do QC failed người khác đã ghi trên Lark.
    const qcCu = larkText(daCo.fields['QC Check']);
    const xoaLyDo = qcCu === 'QC Failed' && v.qcCheck !== 'QC Failed';
    await updateWhInventoryRecord(daCo.record_id, cotCapNhat(v, xoaLyDo));
    return { larkRecordId: daCo.record_id, tao: false };
  }
  const { cot, boQua } = locCotChon(cotTaoDong(v, ngay), await optionCacCotPhaiKiem());
  for (const b of boQua) {
    console.warn(`[wh-inventory] bỏ cột "${b.cot}" của đơn ${v.orderNumber}: Lark chưa có lựa chọn "${b.giaTri}"`);
  }
  const id = await createWhInventoryRecord(cot);
  return { larkRecordId: id, tao: true };
}
