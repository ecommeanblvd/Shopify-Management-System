'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ngayKinhDoanh } from '@/lib/timezone';
import { applyMovement } from '@/features/warehouse/ledger';
import { requireQuanLyKol, requireXemKol } from './perm';
import { chuyenDuoc, suaGiaVonDuoc } from './trang-thai';
import { maDonKol } from './ma-don';
import { kiemTraVe } from './tra-ve';
import { draftGiuCho, draftTraCho, draftXuat, draftNhapLai } from './ton-kho';
import { chonGiaVon } from './gia-von';
import { tonKhaDung } from './queries';
import type { HinhThuc, MucDich } from './types';

const MUC_DICH_HOP_LE: readonly MucDich[] = ['kol', 'chup_do', 'khac'];

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

    const giaVonTho = String(r.giaVon ?? '').trim();
    dong.push({
      sku,
      tenHang: (typeof r.tenHang === 'string' && r.tenHang.trim()) || null,
      kho,
      soLuong,
      hinhThuc,
      hanTra,
      giaVon: giaVonTho || null,
      giaVonTienTe: giaVonTho ? (String(r.giaVonTienTe ?? '').trim() || 'VND') : null,
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

/**
 * Tra giá vốn hiện hành cho một SKU, tại một ngày — dùng chung cho gợi ý lúc
 * gõ form (`goiYGiaVon`) và lúc đông cứng khi gửi (`danhDauDaGui`), để hai nơi
 * không bao giờ lệch logic. KHÔNG export — chỉ dùng nội bộ file này.
 */
async function traGiaVonHienHanh(sku: string, ngay: string): Promise<{ costPerUnit: string; currency: string } | null> {
  const storeId = await storeCuaSku(db, sku);
  // Không xác định được sku này thuộc cửa hàng nào thì KHÔNG tra sku_costs —
  // trả null. Xem giải thích đầy đủ ở storeCuaSku.
  if (!storeId) return null;
  const ds = await db.select({
    costPerUnit: schema.skuCosts.costPerUnit,
    currency: schema.skuCosts.currency,
    effectiveFrom: schema.skuCosts.effectiveFrom,
  }).from(schema.skuCosts).where(and(eq(schema.skuCosts.sku, sku), eq(schema.skuCosts.storeId, storeId)));
  return chonGiaVon(ds, ngay);
}

/**
 * Gợi ý giá vốn khi người dùng gõ mã hàng ở form tạo đơn. Chỉ ĐỌC — gác bằng
 * `requireXemKol`, không phải `requireQuanLyKol`. Trả null khi không tra được;
 * màn hình phải để trống chứ không bịa số.
 */
export async function goiYGiaVon(sku: string): Promise<{ gia: string; tienTe: string } | null> {
  await requireXemKol();
  const s = sku.trim();
  if (!s) return null;
  const homNay = ngayKinhDoanh(new Date())!;
  const g = await traGiaVonHienHanh(s, homNay);
  return g ? { gia: g.costPerUnit, tienTe: g.currency } : null;
}

/**
 * Tồn khả dụng cho một SKU tại một kho — dùng để hiện ngay cạnh dòng hàng lúc
 * người dùng đang gõ form, trước khi lưu. Chỉ ĐỌC.
 */
export async function traTonKhaDung(sku: string, kho: string): Promise<number> {
  await requireXemKol();
  if (!sku.trim() || !kho.trim()) return 0;
  return tonKhaDung(sku.trim(), kho.trim());
}

/** Sổ KOL: thêm một người nhận mới. Chỉ `ten` bắt buộc. */
export async function taoNguoiNhan(fd: FormData): Promise<{ ok: boolean; loi?: string; id?: string }> {
  const actor = await requireQuanLyKol();
  const ten = String(fd.get('ten') ?? '').trim();
  if (!ten) return { ok: false, loi: 'Tên người nhận là bắt buộc.' };

  const chuoi = (khoa: string) => (String(fd.get(khoa) ?? '').trim() || null);

  const [row] = await db.insert(schema.kolNguoiNhan).values({
    ten,
    kenh: chuoi('kenh'),
    dienThoai: chuoi('dienThoai'),
    email: chuoi('email'),
    quocGia: chuoi('quocGia') ?? 'VN',
    diaChi: chuoi('diaChi'),
    thanhPho: chuoi('thanhPho'),
    ghiChu: chuoi('ghiChu'),
    taoBoi: actor,
    suaBoi: actor,
  }).returning({ id: schema.kolNguoiNhan.id });

  revalidatePath('/f/kol');
  revalidatePath('/f/kol/nguoi-nhan');
  return { ok: true, id: row.id };
}

/**
 * Tạo đơn ở trạng thái `nhap`, KHÔNG đụng tồn kho. Chụp ảnh thông tin nhận từ
 * sổ KOL sang đơn tại thời điểm này — sửa sổ về sau không đổi đơn cũ.
 */
export async function taoDon(fd: FormData): Promise<{ ok: boolean; loi?: string; ma?: string }> {
  const actor = await requireQuanLyKol();
  const nguoiNhanId = String(fd.get('nguoiNhanId') ?? '').trim();
  const mucDich = String(fd.get('mucDich') ?? '') as MucDich;
  const ghiChu = String(fd.get('ghiChu') ?? '').trim() || null;

  if (!nguoiNhanId) return { ok: false, loi: 'Phải chọn người nhận.' };
  if (!MUC_DICH_HOP_LE.includes(mucDich)) return { ok: false, loi: 'Mục đích không hợp lệ.' };

  let dongRaw: unknown;
  try {
    dongRaw = JSON.parse(String(fd.get('dong') ?? '[]'));
  } catch {
    return { ok: false, loi: 'Dữ liệu dòng hàng không đọc được.' };
  }
  const kiemDong = kiemDongTao(dongRaw);
  if (!kiemDong.ok) return { ok: false, loi: kiemDong.loi };

  const [nguoiNhan] = await db.select().from(schema.kolNguoiNhan).where(eq(schema.kolNguoiNhan.id, nguoiNhanId));
  if (!nguoiNhan) return { ok: false, loi: 'Không tìm thấy người nhận trong sổ KOL.' };

  const luc = new Date();
  const seq = await db.execute<{ v: string }>('SELECT nextval(\'kol_don_seq\') AS v');
  const soSeq = Number(seq.rows[0]?.v);
  const ma = maDonKol(soSeq, luc);

  // Một transaction cho cả hai insert: đơn có mã mà không dòng nào (do lỗi giữa
  // chừng) là một đơn ma không action nào dọn được — sequence cháy một số thì
  // chấp nhận được (Postgres luôn vậy), nhưng đơn nửa vời thì không.
  try {
    await db.transaction(async (tx) => {
      const [don] = await tx.insert(schema.kolDon).values({
        ma,
        nguoiNhanId,
        mucDich,
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
  const donId = String(fd.get('donId') ?? '');
  const hang = String(fd.get('hangVanChuyen') ?? '').trim();
  const maVanDon = String(fd.get('maVanDon') ?? '').trim();
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
      // Khoá luôn các dòng hàng: `suaGiaVon` được phép sửa giá vốn khi đơn còn
      // 'da_chot' (suaGiaVonDuoc), nên nếu không khoá thì một sửa giá tay có thể
      // chen vào giữa lúc đọc và lúc đông cứng ở dưới.
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
  const dongId = String(fd.get('dongId') ?? '');
  const soLuong = Number(fd.get('soLuong') ?? 0);
  const nhapLaiKho = fd.get('nhapLaiKho') === '1';
  const lyDo = (fd.get('lyDoKhongNhap') as string | null) ?? null;

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
 * Gác đúng như các action ghi khác: `requireQuanLyKol` + kiểm `suaGiaVonDuoc`
 * (nới tới 'da_chot' vì giá vốn không đụng tồn kho).
 */
export async function suaGiaVon(fd: FormData): Promise<{ ok: boolean; loi?: string }> {
  await requireQuanLyKol();
  const dongId = String(fd.get('dongId') ?? '').trim();
  const giaVonTho = String(fd.get('giaVon') ?? '').trim();
  const giaVonTienTeTho = String(fd.get('giaVonTienTe') ?? '').trim();

  const [d] = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.id, dongId));
  if (!d) return { ok: false, loi: 'Không tìm thấy dòng hàng.' };
  const [don] = await db.select().from(schema.kolDon).where(eq(schema.kolDon.id, d.donId));
  if (!don) return { ok: false, loi: 'Không tìm thấy đơn.' };
  if (!suaGiaVonDuoc(don.trangThai)) {
    return { ok: false, loi: `Đơn đang ở trạng thái ${don.trangThai}, không sửa giá vốn được.` };
  }
  if (!giaVonTho) return { ok: false, loi: 'Giá vốn không được để trống.' };
  const so = Number(giaVonTho);
  if (!Number.isFinite(so) || so < 0) return { ok: false, loi: 'Giá vốn phải là một số không âm.' };

  await db.update(schema.kolDongDon)
    .set({ giaVon: giaVonTho, giaVonTienTe: giaVonTienTeTho || 'VND', giaVonNguon: 'tay' })
    .where(eq(schema.kolDongDon.id, dongId));

  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${don.ma}`);
  return { ok: true };
}
