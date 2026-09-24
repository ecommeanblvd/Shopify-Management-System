'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ngayKinhDoanh } from '@/lib/timezone';
import { applyMovement } from '@/features/warehouse/ledger';
import { requireQuanLyKol } from './perm';
import { chuyenDuoc, ghiGiaVonDuoc, giaVonDangTrong } from './trang-thai';
import { dangUuid } from './uuid';
import { maDonKol } from './ma-don';
import { kiemTraVe } from './tra-ve';
import { draftGiuCho, draftTraCho, draftXuat, draftNhapLai } from './ton-kho';
import { chonGiaVon } from './gia-von';
import { tonKhaDung } from './queries';
import type { HinhThuc } from './types';

/**
 * Tiền tệ hợp lệ cho giá vốn — đúng tập mà phần còn lại của luồng (sku_costs,
 * chonGiaVon, chi-phí) thật sự dùng. Đo 23/09/2026: sku_costs chỉ có VND và USD
 * (4.105 dòng VND, 10 dòng USD). Cột `gia_von_tien_te` là `text`, không có CHECK
 * ở CSDL — chặn ở đây, không thì chuỗi bất kỳ (kể cả rỗng-nhưng-không-rỗng-sau-
 * trim, kiểu gõ nhầm) lọt thẳng vào cột.
 */
const TIEN_TE_HOP_LE = ['VND', 'USD'] as const;

/**
 * Cột `gia_von` là `numeric(14, 4)` — tối đa 10 chữ số phần nguyên. Postgres
 * ném "numeric field overflow" khi vượt ngưỡng này (đã xác nhận với
 * `'1e30'::numeric(14,4)`), một lỗi hạ tầng thoát ra ngoài server action nếu
 * không chặn ở tầng ứng dụng trước.
 */
const GIA_VON_TOI_DA = 10 ** 10;

/** Thông báo dùng chung khi giá vốn gõ vào không phải số hợp lệ / vượt sức chứa của cột. */
function loiGiaVonKhongHopLe(): string {
  return `Giá vốn phải là một số không âm và nhỏ hơn ${GIA_VON_TOI_DA.toLocaleString('vi-VN')}.`;
}

/** THUẦN: giá vốn gõ tay có nằm trong khoảng cột `numeric(14,4)` chứa được không. */
function giaVonHopLe(giaVonTho: string): boolean {
  const so = Number(giaVonTho);
  return Number.isFinite(so) && so >= 0 && so < GIA_VON_TOI_DA;
}

/** THUẦN: tiền tệ có nằm trong whitelist không — cột là `text`, CSDL không chặn hộ. */
function tienTeHopLe(tienTe: string): boolean {
  return TIEN_TE_HOP_LE.includes(tienTe as (typeof TIEN_TE_HOP_LE)[number]);
}

/**
 * Lỗi NGHIỆP VỤ có thể trả thẳng ra người dùng nguyên văn `message` (không tìm
 * thấy, sai trạng thái, thiếu dữ liệu...). KHÔNG export — chỉ dùng nội bộ để
 * phân biệt với lỗi hạ tầng (mất kết nối, deadlock, applyMovement ném vì thiếu
 * tồn...), thứ phải được LOG lại chứ không được nuốt hay lộ nguyên văn ra UI.
 */
class LoiNghiepVu extends Error {}

/** Một dòng hàng gõ trong form tạo đơn — chưa qua kiểm tra. */
interface DongTaoTho {
  sku?: unknown;
  shopifyVariantId?: unknown;
  tenHang?: unknown;
  kho?: unknown;
  soLuong?: unknown;
  hinhThuc?: unknown;
  hanTra?: unknown;
  giaVon?: unknown;
  giaVonTienTe?: unknown;
}

interface DongTaoDaKiem {
  sku: string;
  shopifyVariantId: string | null;
  tenHang: string | null;
  kho: string;
  soLuong: number;
  hinhThuc: HinhThuc;
  hanTra: string | null;
  giaVon: string | null;
  giaVonTienTe: string | null;
}

/** Kiểm và chuẩn hoá mảng dòng hàng gõ trong form tạo đơn. Không export — chỉ dùng nội bộ. */
function kiemDongTao(dongRaw: unknown): { ok: true; dong: DongTaoDaKiem[] } | { ok: false; loi: string } {
  if (!Array.isArray(dongRaw) || dongRaw.length === 0) {
    return { ok: false, loi: 'Đơn phải có ít nhất một dòng hàng.' };
  }
  const dong: DongTaoDaKiem[] = [];
  for (let i = 0; i < dongRaw.length; i++) {
    const r = (dongRaw[i] ?? {}) as DongTaoTho;
    const sku = String(r.sku ?? '').trim();
    // ID biến thể chỉ nhận đúng khuôn gid Shopify. Dòng hàng tới đây là một
    // khối JSON trong FormData nên người dùng post được chuỗi bất kỳ; nhận bừa
    // thì cột định danh — thứ đang thay dần SKU — nhiễm rác ngay từ đầu.
    const variantTho = String(r.shopifyVariantId ?? '').trim();
    const shopifyVariantId = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/.test(variantTho) ? variantTho : null;
    const kho = String(r.kho ?? '').trim();
    const soLuong = Number(r.soLuong);
    const hinhThuc: HinhThuc = r.hinhThuc === 'muon' ? 'muon' : 'tang';
    const hanTraTho = String(r.hanTra ?? '').trim();
    const hanTra = hinhThuc === 'muon' ? (hanTraTho || null) : null;

    if (!sku) return { ok: false, loi: `Dòng ${i + 1}: thiếu mã hàng.` };
    if (!kho) return { ok: false, loi: `Dòng ${i + 1} (${sku}): thiếu kho.` };
    if (!Number.isInteger(soLuong) || soLuong <= 0) {
      return { ok: false, loi: `Dòng ${i + 1} (${sku}): số lượng phải là số nguyên dương.` };
    }
    if (hinhThuc === 'muon' && !hanTra) {
      return { ok: false, loi: `Dòng ${i + 1} (${sku}): hình thức mượn bắt buộc phải có hạn trả.` };
    }
    // Cột DB là `date` — gõ "tuần sau" hay bất cứ chuỗi không đúng khuôn thì Postgres
    // ném lỗi thô. Chặn ở đây để người dùng thấy đúng dòng nào sai, đúng khuôn ngày nào.
    if (hanTra && !/^\d{4}-\d{2}-\d{2}$/.test(hanTra)) {
      return { ok: false, loi: `Dòng ${i + 1} (${sku}): hạn trả phải theo định dạng YYYY-MM-DD.` };
    }

    // Giá vốn và tiền tệ phải qua ĐÚNG hai chốt chặn mà `suaGiaVon` đã dùng, vì
    // cả hai đường đều ghi vào cùng hai cột đó. Dòng hàng tới đây dưới dạng một
    // khối JSON trong FormData, nên người dùng có quyền tạo đơn vẫn post thẳng
    // được một loại tiền không có trong whitelist (cột `text`, không CHECK ở
    // CSDL — rồi nó thành một thùng tiền tệ lạ trong báo cáo) hoặc một con số
    // phi số / tràn `numeric(14,4)` (Postgres ném 22003, thoát ra thành lỗi
    // chung "Tạo đơn thất bại" chứ không chỉ ra dòng nào sai).
    const giaVonTho = String(r.giaVon ?? '').trim();
    let giaVonTienTe: string | null = null;
    if (giaVonTho) {
      if (!giaVonHopLe(giaVonTho)) {
        return { ok: false, loi: `Dòng ${i + 1} (${sku}): ${loiGiaVonKhongHopLe()}` };
      }
      giaVonTienTe = String(r.giaVonTienTe ?? '').trim() || 'VND';
      if (!tienTeHopLe(giaVonTienTe)) {
        return {
          ok: false,
          loi: `Dòng ${i + 1} (${sku}): đơn vị tiền tệ không hợp lệ. Chỉ nhận: ${TIEN_TE_HOP_LE.join(', ')}.`,
        };
      }
    }

    dong.push({
      sku,
      shopifyVariantId,
      tenHang: (typeof r.tenHang === 'string' && r.tenHang.trim()) || null,
      kho,
      soLuong,
      hinhThuc,
      hanTra,
      giaVon: giaVonTho || null,
      giaVonTienTe,
    });
  }
  return { ok: true, dong };
}

/** Kiểu dùng chung cho `db` (ngoài transaction) hoặc `tx` (trong transaction). */
type DbHoacTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Suy ra cửa hàng (store) thật sự của một SKU, qua `shopify_variants` — nguồn
 * DUY NHẤT trong hệ thống gắn một SKU với `store_id`. Đúng cách đã dùng ở việc
 * dán mã vạch (`features/kho-nhan/queries.ts`): chỉ tin khi SKU khớp ĐÚNG MỘT
 * store, còn lại (0 hoặc nhiều hơn 1) thì trả null — không đoán bừa.
 *
 * KHÔNG dùng số lượng store trong `sku_costs` làm bằng chứng có mặt cửa hàng
 * đúng — đó là lỗ hổng cũ: một SKU vẫn có thể chỉ vô tình có giá ở ĐÚNG MỘT cửa
 * hàng SAI (không phải cửa hàng hàng thật sự thuộc về), và "chỉ có 1 store
 * trong sku_costs" không phân biệt được hai trường hợp đó. Đo 23/09/2026: 6 SKU
 * (`TINH-SS25-06-...`) chỉ có giá dưới `tinhatelier` trong `sku_costs`;
 * `shopify_variants` (hiện chỉ đồng bộ mỗi `meanblvd`) không xác nhận được các
 * SKU đó thuộc cửa hàng nào — nên đúng đắn là trả null, KHÔNG đóng đinh giá của
 * một brand khác vào dòng hàng KOL.
 */
async function storeCuaSku(chay: DbHoacTx, sku: string): Promise<string | null> {
  const bienThe = await chay.select({ storeId: schema.shopifyVariants.storeId })
    .from(schema.shopifyVariants).where(eq(schema.shopifyVariants.sku, sku));
  const boStore = new Set(bienThe.map((v) => v.storeId));
  return boStore.size === 1 ? [...boStore][0]! : null;
}




/** Sổ KOL: thêm một người nhận mới. Chỉ `ten` bắt buộc. */

/** Loại người nhận từ form — giá trị lạ thì về 'kol', KHÔNG ném lỗi: đây là ô
 *  chọn hai nút, chuỗi lạ chỉ có thể do form bị sửa tay. */
function docLoai(fd: FormData): 'kol' | 'ph' {
  return String(fd.get('loai') ?? '') === 'ph' ? 'ph' : 'kol';
}

export async function taoNguoiNhan(fd: FormData): Promise<{ ok: boolean; loi?: string; id?: string }> {
  const actor = await requireQuanLyKol();
  const ten = String(fd.get('ten') ?? '').trim();
  if (!ten) return { ok: false, loi: 'Tên người nhận là bắt buộc.' };

  const chuoi = (khoa: string) => (String(fd.get(khoa) ?? '').trim() || null);

  // Cùng nếp với `suaNguoiNhan`/`doiNgungDung`: chữ ký hứa trả {ok, loi} nên lỗi
  // hạ tầng phải được LOG rồi quy về một thông báo, không ném thô ra ngoài
  // server action.
  let id: string;
  try {
    const [row] = await db.insert(schema.kolNguoiNhan).values({
      ten,
      kenh: chuoi('kenh'),
      dienThoai: chuoi('dienThoai'),
      email: chuoi('email'),
      quocGia: chuoi('quocGia') ?? 'VN',
      diaChi: chuoi('diaChi'),
      thanhPho: chuoi('thanhPho'),
      ghiChu: chuoi('ghiChu'),
      loai: docLoai(fd),
      taoBoi: actor,
      suaBoi: actor,
    }).returning({ id: schema.kolNguoiNhan.id });
    id = row.id;
  } catch (e) {
    console.error('[kol] taoNguoiNhan lỗi:', e);
    return { ok: false, loi: 'Thêm hồ sơ thất bại, thử lại.' };
  }

  revalidatePath('/f/kol');
  revalidatePath('/f/kol/nguoi-nhan');
  return { ok: true, id };
}

/**
 * Sửa hồ sơ sổ KOL đã có. Cùng luật với `taoNguoiNhan` — chỉ `ten` bắt buộc.
 * KHÔNG đụng cờ `ngungDung` ở đây: tách riêng sang `doiNgungDung` để một lần
 * sửa thông tin liên hệ không thể vô tình bật/tắt một người đang dùng (hai
 * form khác nhau trên UI, hai chủ đích khác nhau, không nên chung một action
 * mà lỡ tay đè lẫn nhau).
 */
export async function suaNguoiNhan(fd: FormData): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const id = String(fd.get('id') ?? '').trim();
  if (!dangUuid(id)) return { ok: false, loi: 'Không tìm thấy hồ sơ.' };
  const ten = String(fd.get('ten') ?? '').trim();
  if (!ten) return { ok: false, loi: 'Tên người nhận là bắt buộc.' };

  const chuoi = (khoa: string) => (String(fd.get(khoa) ?? '').trim() || null);

  try {
    const ket = await db.update(schema.kolNguoiNhan).set({
      ten,
      kenh: chuoi('kenh'),
      dienThoai: chuoi('dienThoai'),
      email: chuoi('email'),
      quocGia: chuoi('quocGia') ?? 'VN',
      diaChi: chuoi('diaChi'),
      thanhPho: chuoi('thanhPho'),
      ghiChu: chuoi('ghiChu'),
      // Đổi loại chỉ ảnh hưởng đơn TẠO SAU: đơn cũ đã chụp `loai_nhan` riêng,
      // vì mã đơn của chúng đã phát ra theo loại cũ.
      loai: docLoai(fd),
      suaLuc: new Date(),
      suaBoi: actor,
    }).where(eq(schema.kolNguoiNhan.id, id)).returning({ id: schema.kolNguoiNhan.id });
    if (ket.length === 0) return { ok: false, loi: 'Không tìm thấy hồ sơ.' };
  } catch (e) {
    console.error('[kol] suaNguoiNhan lỗi:', e);
    return { ok: false, loi: 'Sửa hồ sơ thất bại, thử lại.' };
  }

  revalidatePath('/f/kol');
  revalidatePath('/f/kol/nguoi-nhan');
  return { ok: true };
}

/**
 * Bật/tắt cờ ngừng dùng của một hồ sơ sổ KOL. KHÔNG xoá hồ sơ: đơn cũ đang
 * tham chiếu `nguoi_nhan_id` vẫn phải tra ngược được người nhận (xem chú
 * thích cột `ngungDung` ở db/schema.ts — "ẩn khỏi ô chọn mà KHÔNG xoá").
 * Ngừng dùng chỉ ẩn hồ sơ khỏi ô chọn lúc TẠO đơn mới (`danhSachNguoiNhan()`
 * mặc định lọc `ngungDung = false`), không ảnh hưởng đơn đã có.
 */
export async function doiNgungDung(id: string, ngungDung: boolean): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  if (!dangUuid(id)) return { ok: false, loi: 'Không tìm thấy hồ sơ.' };

  try {
    const ket = await db.update(schema.kolNguoiNhan)
      .set({ ngungDung, suaLuc: new Date(), suaBoi: actor })
      .where(eq(schema.kolNguoiNhan.id, id))
      .returning({ id: schema.kolNguoiNhan.id });
    if (ket.length === 0) return { ok: false, loi: 'Không tìm thấy hồ sơ.' };
  } catch (e) {
    console.error('[kol] doiNgungDung lỗi:', e);
    return { ok: false, loi: 'Đổi trạng thái ngừng dùng thất bại, thử lại.' };
  }

  revalidatePath('/f/kol');
  revalidatePath('/f/kol/nguoi-nhan');
  return { ok: true };
}

/**
 * Tạo đơn ở trạng thái `nhap`, KHÔNG đụng tồn kho. Chụp ảnh thông tin nhận từ
 * sổ KOL sang đơn tại thời điểm này — sửa sổ về sau không đổi đơn cũ.
 */
export async function taoDon(fd: FormData): Promise<{ ok: boolean; loi?: string; ma?: string }> {
  const actor = await requireQuanLyKol();
  const nguoiNhanId = String(fd.get('nguoiNhanId') ?? '').trim();
  const ghiChu = String(fd.get('ghiChu') ?? '').trim() || null;

  // Kiểm hình dạng uuid, không chỉ "khác rỗng": id gõ/dán nhầm đi thẳng vào so
  // sánh cột uuid thì Postgres ném 22P02, và lệnh đọc này nằm NGOÀI try/catch
  // nên nó thoát hẳn ra ngoài server action thay vì thành {ok:false}.
  if (!dangUuid(nguoiNhanId)) return { ok: false, loi: 'Phải chọn người nhận.' };

  let dongRaw: unknown;
  try {
    dongRaw = JSON.parse(String(fd.get('dong') ?? '[]'));
  } catch {
    return { ok: false, loi: 'Dữ liệu dòng hàng không đọc được.' };
  }
  const kiemDong = kiemDongTao(dongRaw);
  if (!kiemDong.ok) return { ok: false, loi: kiemDong.loi };

  const luc = new Date();
  let ma = '';

  // Một transaction cho cả hai insert: đơn có mã mà không dòng nào (do lỗi giữa
  // chừng) là một đơn ma không action nào dọn được — sequence cháy một số thì
  // chấp nhận được (Postgres luôn vậy), nhưng đơn nửa vời thì không.
  //
  // Tra sổ KOL và lấy số thứ tự cũng nằm TRONG try: trước đây hai lệnh đó đứng
  // ngoài nên mọi lỗi hạ tầng ở đó ném thô ra khỏi server action, dù chữ ký hứa
  // trả {ok, loi}.
  try {
    const [nguoiNhan] = await db.select().from(schema.kolNguoiNhan).where(eq(schema.kolNguoiNhan.id, nguoiNhanId));
    if (!nguoiNhan) return { ok: false, loi: 'Không tìm thấy người nhận trong sổ KOL.' };

    const seq = await db.execute<{ v: string }>('SELECT nextval(\'kol_don_seq\') AS v');
    const soSeq = Number(seq.rows[0]?.v);
    // Loại lấy từ SỔ người nhận, không lấy từ form: người dùng không được
    // chọn tay (bản thiết kế 24/09), và form là thứ ai cũng sửa được.
    ma = maDonKol(soSeq, luc, nguoiNhan.loai);

    await db.transaction(async (tx) => {
      const [don] = await tx.insert(schema.kolDon).values({
        ma,
        nguoiNhanId,
        loaiNhan: nguoiNhan.loai,
        trangThai: 'nhap',
        // Ảnh chụp từ sổ KOL — KHÔNG tham chiếu động.
        tenNhan: nguoiNhan.ten,
        dienThoaiNhan: nguoiNhan.dienThoai,
        quocGia: nguoiNhan.quocGia,
        thanhPho: nguoiNhan.thanhPho,
        diaChi: nguoiNhan.diaChi,
        ghiChu,
        taoBoi: actor,
        suaBoi: actor,
      }).returning({ id: schema.kolDon.id });

      await tx.insert(schema.kolDongDon).values(kiemDong.dong.map((d) => ({
        donId: don.id,
        sku: d.sku,
        shopifyVariantId: d.shopifyVariantId,
        tenHang: d.tenHang,
        kho: d.kho,
        soLuong: d.soLuong,
        hinhThuc: d.hinhThuc,
        hanTra: d.hanTra,
        giaVon: d.giaVon,
        giaVonTienTe: d.giaVonTienTe,
        // Người dùng gõ tay ở bước tạo đơn thì đánh dấu 'tay' ngay, không chờ tới lúc gửi.
        giaVonNguon: d.giaVon ? 'tay' : null,
      })));
    });
  } catch (e) {
    console.error('[kol] taoDon lỗi:', e);
    return { ok: false, loi: 'Tạo đơn thất bại, thử lại.' };
  }

  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${ma}`);
  return { ok: true, ma };
}

/**
 * Chốt đơn: giữ chỗ tồn cho từng dòng hàng qua `applyMovement`. Vi phạm bất
 * biến tồn (không đủ hàng) thì báo ĐÚNG mã hàng nào thiếu và thiếu bao nhiêu.
 */
export async function chotDon(donId: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  // Chặn id sai khuôn NGAY: nhánh catch bên dưới đọc lại dòng hàng bằng CHÍNH
  // `donId` này để kể tên mã hàng thiếu tồn, nên một uuid rác ném lần hai ngay
  // bên trong catch — lỗi thứ hai đó không ai bắt.
  if (!dangUuid(donId)) return { ok: false, loi: 'Không tìm thấy đơn.' };
  let maDon = '';
  try {
    await db.transaction(async (tx) => {
      // Khoá đơn: hai người cùng bấm Chốt trên cùng đơn thì người sau phải đợi
      // lock, đọc lại trạng thái MỚI (đã 'da_chot') rồi dội ở chuyenDuoc — không
      // thể giữ chỗ tồn hai lần cho cùng một đơn.
      const [don] = await tx.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId)).for('update');
      if (!don) throw new LoiNghiepVu('Không tìm thấy đơn.');
      if (!chuyenDuoc(don.trangThai, 'da_chot')) {
        throw new LoiNghiepVu(`Đơn đang ở trạng thái ${don.trangThai}, không chốt được.`);
      }
      maDon = don.ma;
      const dong = await tx.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));
      if (dong.length === 0) throw new LoiNghiepVu('Đơn chưa có dòng hàng nào.');
      for (const d of dong) {
        await applyMovement(tx, draftGiuCho({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
      }
      await tx.update(schema.kolDon)
        .set({ trangThai: 'da_chot', suaLuc: new Date(), suaBoi: actor })
        .where(eq(schema.kolDon.id, donId));
    });
  } catch (e) {
    if (e instanceof LoiNghiepVu) return { ok: false, loi: e.message };
    // applyMovement ném khi vi phạm bất biến tồn (hoặc lỗi hạ tầng khác — mất kết
    // nối, deadlock...). LOG lại để không nuốt lỗi hạ tầng, rồi đọc lại NGOÀI
    // transaction (đã rollback) để nói ĐÚNG mã hàng nào thiếu và thiếu bao nhiêu.
    // Cộng dồn theo (sku, kho): một đơn có hai dòng cùng mã hàng cùng kho phải so
    // với TỔNG cần, không phải so từng dòng riêng lẻ với tồn khả dụng — nếu không
    // thì hai dòng 5 cái trong khi tồn chỉ có 7 sẽ không lọt qua vòng lọc thiếu.
    console.error('[kol] chotDon lỗi:', e);
    const dong = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));
    const canTheoKey = new Map<string, { sku: string; kho: string; soLuong: number }>();
    for (const d of dong) {
      const key = `${d.sku}::${d.kho}`;
      const hien = canTheoKey.get(key);
      canTheoKey.set(key, { sku: d.sku, kho: d.kho, soLuong: (hien?.soLuong ?? 0) + d.soLuong });
    }
    const thieu: string[] = [];
    for (const { sku, kho, soLuong } of canTheoKey.values()) {
      const kd = await tonKhaDung(sku, kho);
      if (kd < soLuong) thieu.push(`${sku} tại ${kho}: cần ${soLuong}, còn ${kd}`);
    }
    return {
      ok: false,
      loi: thieu.length
        ? `Không đủ tồn để giữ chỗ — ${thieu.join('; ')}. Nhận hàng vào kho trước rồi chốt lại.`
        : 'Chốt đơn thất bại, tồn kho vừa đổi. Thử lại.',
    };
  }
  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${maDon}`);
  return { ok: true };
}

/**
 * Lùi đơn đã chốt về nháp để sửa dòng hàng. Nếu đang giữ chỗ tồn thì trả lại
 * chỗ đã giữ trong cùng transaction trước khi đổi trạng thái.
 */
export async function luiVeNhap(donId: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  if (!dangUuid(donId)) return { ok: false, loi: 'Không tìm thấy đơn.' };
  let maDon = '';
  try {
    await db.transaction(async (tx) => {
      // Khoá đơn: đang lùi về nháp trong lúc người khác bấm Chốt hoặc Gửi thì
      // người sau đợi lock, đọc lại trạng thái MỚI rồi dội ở chuyenDuoc.
      const [don] = await tx.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId)).for('update');
      if (!don) throw new LoiNghiepVu('Không tìm thấy đơn.');
      if (!chuyenDuoc(don.trangThai, 'nhap')) {
        throw new LoiNghiepVu(`Đơn đang ở trạng thái ${don.trangThai}, không lùi về nháp được.`);
      }
      maDon = don.ma;
      if (don.trangThai === 'da_chot') {
        const dong = await tx.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));
        for (const d of dong) {
          await applyMovement(tx, draftTraCho({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
        }
      }
      await tx.update(schema.kolDon)
        .set({ trangThai: 'nhap', suaLuc: new Date(), suaBoi: actor })
        .where(eq(schema.kolDon.id, donId));
    });
  } catch (e) {
    if (e instanceof LoiNghiepVu) return { ok: false, loi: e.message };
    console.error('[kol] luiVeNhap lỗi:', e);
    return { ok: false, loi: 'Lùi đơn về nháp thất bại, thử lại.' };
  }

  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${maDon}`);
  return { ok: true };
}

/**
 * Đánh dấu đã gửi: xuất tồn thật cho từng dòng và đông cứng giá vốn tại thời
 * điểm gửi — theo GIỜ KINH DOANH, không phải UTC (xem lib/timezone.ts).
 */
export async function danhDauDaGui(fd: FormData): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const donId = String(fd.get('donId') ?? '').trim();
  const hang = String(fd.get('hangVanChuyen') ?? '').trim();
  const maVanDon = String(fd.get('maVanDon') ?? '').trim();
  if (!dangUuid(donId)) return { ok: false, loi: 'Không tìm thấy đơn.' };
  if (!hang || !maVanDon) return { ok: false, loi: 'Phải có tên hãng và mã vận đơn trước khi đánh dấu đã gửi.' };

  const luc = new Date();
  // Giờ NGHIỆP VỤ, không phải UTC. lib/timezone.ts ghi số đo thật: quy theo UTC thì
  // 36,6% đơn lệch ngày và 91 đơn lệch hẳn THÁNG. Chọn sai ngày ở đây là chọn sai
  // dòng giá vốn, rồi con số đó đông cứng vĩnh viễn vào chi phí marketing.
  const ngayGui = ngayKinhDoanh(luc)!;
  let maDon = '';

  try {
    await db.transaction(async (tx) => {
      // Khoá đơn: bấm Đã gửi cùng lúc người khác đang huỷ/lùi thì người sau đợi
      // lock, đọc lại trạng thái MỚI rồi dội ở chuyenDuoc — không thể xuất tồn
      // hai lần hay gửi một đơn vừa bị huỷ.
      const [don] = await tx.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId)).for('update');
      if (!don) throw new LoiNghiepVu('Không tìm thấy đơn.');
      if (!chuyenDuoc(don.trangThai, 'da_gui')) {
        throw new LoiNghiepVu(`Đơn đang ở trạng thái ${don.trangThai}, không gửi được.`);
      }
      maDon = don.ma;
      // Khoá luôn các dòng hàng: chặn race NGAY TRONG transaction này giữa lúc
      // đọc `d.giaVon` và lúc ghi giá đông cứng ở dưới. Đây KHÔNG phải thứ chặn
      // `suaGiaVon` — khoá dòng một mình chỉ biến một UPDATE đọc-cũ của
      // `suaGiaVon` thành một UPDATE ghi-đè-SAU-KHI-commit (nó vẫn chạy tiếp khi
      // khoá dòng ở đây nhả ra, rồi đè lên giá vừa đông cứng trên một đơn giờ đã
      // 'da_gui') — đổi hình dạng của race chứ không triệt tiêu. Race với
      // `suaGiaVon` được chặn Ở TRÊN, tại khoá đơn (`.for('update')` trên `don`):
      // `suaGiaVon` giờ cũng khoá đơn làm việc đầu tiên rồi mới soi lại
      // `suaGiaVonDuoc` trên trạng thái ĐÃ khoá, nên hai bên xếp hàng qua đúng
      // một khoá đó và bên chạy sau luôn thấy trạng thái MỚI. (Fix round 2,
      // 2026-09-23 — bug NEW-1.)
      const dong = await tx.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId)).for('update');

      for (const d of dong) {
        await applyMovement(tx, draftXuat({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
        // Đông cứng giá vốn. Dòng người dùng đã gõ tay thì GIỮ NGUYÊN, không đè.
        if (d.giaVon == null) {
          const g = await (async () => {
            const storeId = await storeCuaSku(tx, d.sku);
            // Không xác định được sku này thuộc cửa hàng nào thì KHÔNG tra
            // sku_costs — trả null. Xem giải thích đầy đủ ở storeCuaSku: không
            // dùng "sku_costs chỉ có 1 store" làm bằng chứng, vì đó đúng là lỗ
            // hổng khiến giá của một brand khác có thể đóng đinh nhầm vào đây.
            if (!storeId) return null;
            const ds = await tx.select({
              costPerUnit: schema.skuCosts.costPerUnit,
              currency: schema.skuCosts.currency,
              effectiveFrom: schema.skuCosts.effectiveFrom,
            }).from(schema.skuCosts)
              .where(and(eq(schema.skuCosts.sku, d.sku), eq(schema.skuCosts.storeId, storeId)));
            return chonGiaVon(ds, ngayGui);
          })();
          // Không tra được thì ĐỂ NULL. Báo cáo sẽ đếm dòng này là "chưa có giá",
          // còn hơn bịa một con số rồi nó nằm trong chi phí marketing mãi mãi.
          if (g) {
            await tx.update(schema.kolDongDon)
              .set({ giaVon: g.costPerUnit, giaVonTienTe: g.currency, giaVonNguon: 'sku_costs' })
              .where(eq(schema.kolDongDon.id, d.id));
          }
        }
      }
      await tx.update(schema.kolDon)
        .set({ trangThai: 'da_gui', hangVanChuyen: hang, maVanDon, guiLuc: luc, suaLuc: luc, suaBoi: actor })
        .where(eq(schema.kolDon.id, donId));
    });
  } catch (e) {
    if (e instanceof LoiNghiepVu) return { ok: false, loi: e.message };
    // applyMovement ném khi thiếu tồn để xuất thật (ví dụ đơn mẫu về-rồi-đi cùng
    // ngày mà chưa nhận vào kho) hoặc lỗi hạ tầng khác — LOG lại, không nuốt.
    console.error('[kol] danhDauDaGui lỗi:', e);
    return { ok: false, loi: 'Đánh dấu đã gửi thất bại — có thể do tồn kho vừa đổi. Thử lại.' };
  }
  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${maDon}`);
  return { ok: true };
}

/**
 * Huỷ đơn. Đang `nhap` thì huỷ thẳng, không đụng tồn. Đang `da_chot` thì trả
 * lại chỗ tồn đã giữ trong cùng transaction rồi mới đổi trạng thái. `da_gui`
 * không huỷ được — hàng đã đi thì đường về là hàng trả, không phải huỷ đơn.
 */
export async function huyDon(donId: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  if (!dangUuid(donId)) return { ok: false, loi: 'Không tìm thấy đơn.' };
  let maDon = '';
  try {
    await db.transaction(async (tx) => {
      // Khoá đơn: huỷ cùng lúc người khác bấm Gửi thì người sau đợi lock, đọc lại
      // trạng thái MỚI rồi dội ở chuyenDuoc — không thể vừa trả chỗ tồn của một
      // đơn vừa được gửi thật, vừa đóng dấu huỷ lên một đơn đã có mã vận đơn.
      const [don] = await tx.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId)).for('update');
      if (!don) throw new LoiNghiepVu('Không tìm thấy đơn.');
      if (!chuyenDuoc(don.trangThai, 'huy')) {
        throw new LoiNghiepVu(`Đơn đang ở trạng thái ${don.trangThai}, không huỷ được.`);
      }
      maDon = don.ma;
      if (don.trangThai === 'da_chot') {
        const dong = await tx.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));
        for (const d of dong) {
          await applyMovement(tx, draftTraCho({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
        }
      }
      await tx.update(schema.kolDon)
        .set({ trangThai: 'huy', suaLuc: new Date(), suaBoi: actor })
        .where(eq(schema.kolDon.id, donId));
    });
  } catch (e) {
    if (e instanceof LoiNghiepVu) return { ok: false, loi: e.message };
    console.error('[kol] huyDon lỗi:', e);
    return { ok: false, loi: 'Huỷ đơn thất bại, thử lại.' };
  }

  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${maDon}`);
  return { ok: true };
}

/** Nhận hàng mượn về: ghi lần trả, cộng dồn số đã trả, cộng tồn nếu nhập lại kho. */
export async function nhanTraVe(fd: FormData): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const dongId = String(fd.get('dongId') ?? '').trim();
  const soLuong = Number(fd.get('soLuong') ?? 0);
  const nhapLaiKho = fd.get('nhapLaiKho') === '1';
  const lyDo = (fd.get('lyDoKhongNhap') as string | null) ?? null;
  if (!dangUuid(dongId)) return { ok: false, loi: 'Không tìm thấy dòng hàng.' };

  let maDon = '';
  try {
    await db.transaction(async (tx) => {
      // Khoá dòng hàng: hai lần "nhận trả về" cùng lúc cho cùng dòng thì người
      // sau phải đợi, đọc lại so_luong_da_tra MỚI rồi mới kiểm — không thì cả
      // hai cùng đọc số cũ, cùng qua kiemTraVe, và ghi đè lên nhau (lost update)
      // mà CHECK ở DB không bắt được vì mỗi lần chỉ ghi một con số tuyệt đối.
      const [d] = await tx.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.id, dongId)).for('update');
      if (!d) throw new LoiNghiepVu('Không tìm thấy dòng hàng.');

      const [don] = await tx.select({ id: schema.kolDon.id, ma: schema.kolDon.ma, trangThai: schema.kolDon.trangThai })
        .from(schema.kolDon).where(eq(schema.kolDon.id, d.donId));
      if (!don) throw new LoiNghiepVu('Không tìm thấy đơn.');
      // Đơn chưa ở trạng thái 'da_gui' thì hàng chưa từng rời kho thật (chỉ mới
      // giữ chỗ, hoặc chưa giữ chỗ gì cả) — không có gì để "trả về". Thiếu chặn
      // này thì một đơn nháp/đã chốt/đã huỷ vẫn nhận được trả, cộng tồn cho hàng
      // chưa từng xuất kho.
      if (don.trangThai !== 'da_gui') {
        throw new LoiNghiepVu(`Đơn đang ở trạng thái ${don.trangThai}, chưa gửi thì không có gì để nhận trả về.`);
      }
      maDon = don.ma;

      const kiem = kiemTraVe(
        { id: d.id, sku: d.sku, tenHang: d.tenHang, kho: d.kho, soLuong: d.soLuong, hinhThuc: d.hinhThuc,
          hanTra: d.hanTra, giaVon: d.giaVon, giaVonTienTe: d.giaVonTienTe,
          soLuongDaTra: d.soLuongDaTra, soLuongNhapLai: d.soLuongNhapLai },
        soLuong, nhapLaiKho, lyDo,
      );
      if (!kiem.ok) throw new LoiNghiepVu(kiem.loi);

      await tx.insert(schema.kolTraVe).values({
        dongDonId: dongId, soLuong, nhapLaiKho,
        lyDoKhongNhap: nhapLaiKho ? null : lyDo, taoBoi: actor,
      });
      // Ghi bằng SQL increment, không phải số tuyệt đối tính sẵn trong JS: khoá
      // dòng ở trên đã đủ tránh lost update, nhưng cộng ngay tại CSDL biến CHECK
      // so_luong_da_tra <= so_luong thành lưới chắn thật, không chỉ trên giấy.
      await tx.update(schema.kolDongDon).set({
        soLuongDaTra: sql`${schema.kolDongDon.soLuongDaTra} + ${soLuong}`,
        // Chỉ phần NHẬP LẠI mới rời khỏi chi phí. Hàng về mà hỏng vẫn là tiền đã tiêu.
        soLuongNhapLai: sql`${schema.kolDongDon.soLuongNhapLai} + ${nhapLaiKho ? soLuong : 0}`,
      }).where(eq(schema.kolDongDon.id, dongId));
      if (nhapLaiKho) {
        await applyMovement(tx, draftNhapLai({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, soLuong, actor));
      }
    });
  } catch (e) {
    if (e instanceof LoiNghiepVu) return { ok: false, loi: e.message };
    console.error('[kol] nhanTraVe lỗi:', e);
    return { ok: false, loi: 'Nhận hàng trả về thất bại, thử lại.' };
  }
  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${maDon}`);
  return { ok: true };
}

/**
 * Sửa giá vốn một dòng hàng đã tạo. KHÔNG có ở Task 6 — thêm ở Task 7 vì màn
 * chi tiết cần cho phép điền giá vốn còn thiếu (spec: "chưa có giá thì để
 * trống, không bịa số" — nhưng người dùng phải có chỗ để điền vào SAU đó).
 * Gác đúng như các action ghi khác: `requireQuanLyKol` + kiểm `ghiGiaVonDuoc`
 * trên hàng ĐÃ KHOÁ.
 *
 * `ghiGiaVonDuoc` (chứ không phải `suaGiaVonDuoc`) vì nó xét cả giá hiện có:
 * nháp/đã chốt sửa thoải mái, ĐÃ GỬI thì chỉ ĐIỀN được vào ô còn TRỐNG và
 * không bao giờ đổi được một con số đã có. Lý do ở docstring của luật đó và ở
 * spec §7.2 — tóm tắt: lúc gửi, giá vốn cố ý để `null` khi không phân giải được
 * cửa hàng của mã hàng, nên nếu chặn theo đúng trạng thái thì những dòng ấy vô
 * giá vĩnh viễn và tiền của chúng không bao giờ vào chi phí marketing.
 *
 * Khoá đơn (không phải dòng) rồi mới soi lại `suaGiaVonDuoc`, giống hệt bài
 * `chotDon`/`danhDauDaGui`: đọc-rồi-ghi không khoá gì từng cho phép một sửa giá
 * tay đã qua guard lúc đơn còn 'da_chot' bị BLOCK trên khoá dòng của
 * `danhDauDaGui`, rồi khi khoá đó nhả ra thì UPDATE này tiếp tục chạy và ĐÈ lên
 * giá vốn vừa đông cứng lúc gửi — trên một đơn giờ đã 'da_gui', trạng thái mà
 * guard lẽ ra phải cấm. Khoá dòng của `danhDauDaGui` chỉ đổi UPDATE này từ "đọc
 * cũ" thành "ghi đè sau khi đã commit" — không hề triệt tiêu race, chỉ đổi
 * hình dạng của nó. Khoá đơn ở đây mới là thứ thật sự chặn: `danhDauDaGui`
 * cũng khoá đơn làm việc đầu tiên, nên hai bên phải xếp hàng qua cùng một khoá
 * và bên sau luôn đọc lại trạng thái MỚI trước khi quyết định.
 */
export async function suaGiaVon(fd: FormData): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const dongId = String(fd.get('dongId') ?? '').trim();
  const giaVonTho = String(fd.get('giaVon') ?? '').trim();
  const giaVonTienTeTho = String(fd.get('giaVonTienTe') ?? '').trim();

  if (!dangUuid(dongId)) return { ok: false, loi: 'Không tìm thấy dòng hàng.' };
  if (!giaVonTho) return { ok: false, loi: 'Giá vốn không được để trống.' };
  // Cột là numeric(14,4): tối đa 10 chữ số phần nguyên. Số vượt ngưỡng khiến
  // Postgres ném lỗi hạ tầng (numeric field overflow) thay vì trả về kết quả
  // NGHIỆP VỤ đã hứa — chặn ở đây trước khi chạm CSDL.
  if (!giaVonHopLe(giaVonTho)) return { ok: false, loi: loiGiaVonKhongHopLe() };
  const tienTe = giaVonTienTeTho || 'VND';
  if (!tienTeHopLe(tienTe)) {
    return { ok: false, loi: `Đơn vị tiền tệ không hợp lệ. Chỉ nhận: ${TIEN_TE_HOP_LE.join(', ')}.` };
  }

  let maDon = '';
  try {
    await db.transaction(async (tx) => {
      // Chỉ lấy donId để biết khoá đơn nào — dong_don.don_id không bao giờ đổi
      // sau khi tạo dòng (không action nào trong file này UPDATE nó), nên đọc
      // không khoá ở bước này không mở lại race nào cả.
      const [dRaw] = await tx.select({ donId: schema.kolDongDon.donId })
        .from(schema.kolDongDon).where(eq(schema.kolDongDon.id, dongId));
      if (!dRaw) throw new LoiNghiepVu('Không tìm thấy dòng hàng.');

      // Khoá đơn: xem giải thích ở đầu hàm — đây là bước chặn race với
      // `danhDauDaGui` (và các action đổi trạng thái khác), không phải khoá dòng.
      const [don] = await tx.select().from(schema.kolDon).where(eq(schema.kolDon.id, dRaw.donId)).for('update');
      if (!don) throw new LoiNghiepVu('Không tìm thấy đơn.');
      maDon = don.ma;

      // Đọc giá hiện tại SAU khi đã khoá đơn, không phải ở lệnh đọc đầu hàm:
      // `danhDauDaGui` là nơi duy nhất khác ghi cột này, và nó khoá CHÍNH đơn
      // này ở bước đầu tiên — nên dưới khoá đó giá trị đọc ra không thể đổi
      // dưới chân ta nữa, còn đọc trước khoá thì có thể vừa bị đông cứng xong.
      const [dHien] = await tx.select({ giaVon: schema.kolDongDon.giaVon })
        .from(schema.kolDongDon).where(eq(schema.kolDongDon.id, dongId));
      if (!dHien) throw new LoiNghiepVu('Không tìm thấy dòng hàng.');

      if (!ghiGiaVonDuoc(don.trangThai, dHien.giaVon)) {
        throw new LoiNghiepVu(
          don.trangThai === 'da_gui' && !giaVonDangTrong(dHien.giaVon)
            ? 'Đơn đã gửi — giá vốn đã đông cứng lúc gửi, không sửa lại được. Chỉ dòng còn TRỐNG giá mới điền được.'
            : `Đơn đang ở trạng thái ${don.trangThai}, không sửa giá vốn được.`,
        );
      }

      await tx.update(schema.kolDongDon)
        .set({ giaVon: giaVonTho, giaVonTienTe: tienTe, giaVonNguon: 'tay' })
        .where(eq(schema.kolDongDon.id, dongId));

      // Đóng dấu người sửa lên đơn: `kol_dong_don` không có cột kiểm toán
      // riêng, mà từ nay một dòng ĐÃ GỬI còn trống giá vẫn điền được — phải
      // truy ra được ai điền và lúc nào. Đơn đang giữ khoá nên không thêm
      // tranh chấp.
      await tx.update(schema.kolDon)
        .set({ suaLuc: new Date(), suaBoi: actor })
        .where(eq(schema.kolDon.id, don.id));
    });
  } catch (e) {
    if (e instanceof LoiNghiepVu) return { ok: false, loi: e.message };
    console.error('[kol] suaGiaVon lỗi:', e);
    return { ok: false, loi: 'Sửa giá vốn thất bại, thử lại.' };
  }

  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${maDon}`);
  return { ok: true };
}
