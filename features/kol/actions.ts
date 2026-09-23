'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { ngayKinhDoanh } from '@/lib/timezone';
import { applyMovement } from '@/features/warehouse/ledger';
import { requireQuanLyKol } from './perm';
import { chuyenDuoc } from './trang-thai';
import { maDonKol } from './ma-don';
import { kiemTraVe } from './tra-ve';
import { draftGiuCho, draftTraCho, draftXuat, draftNhapLai } from './ton-kho';
import { chonGiaVon } from './gia-von';
import { tonKhaDung } from './queries';
import type { HinhThuc, MucDich } from './types';

const MUC_DICH_HOP_LE: readonly MucDich[] = ['kol', 'chup_do', 'khac'];

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

  const [don] = await db.insert(schema.kolDon).values({
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

  await db.insert(schema.kolDongDon).values(kiemDong.dong.map((d) => ({
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
  const [don] = await db.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId));
  if (!don) return { ok: false, loi: 'Không tìm thấy đơn.' };
  if (!chuyenDuoc(don.trangThai, 'da_chot')) {
    return { ok: false, loi: `Đơn đang ở trạng thái ${don.trangThai}, không chốt được.` };
  }
  const dong = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));
  if (dong.length === 0) return { ok: false, loi: 'Đơn chưa có dòng hàng nào.' };

  try {
    await db.transaction(async (tx) => {
      for (const d of dong) {
        await applyMovement(tx, draftGiuCho({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
      }
      await tx.update(schema.kolDon)
        .set({ trangThai: 'da_chot', suaLuc: new Date(), suaBoi: actor })
        .where(eq(schema.kolDon.id, donId));
    });
  } catch {
    // applyMovement ném khi vi phạm bất biến tồn. Nói ĐÚNG mã hàng nào thiếu và
    // thiếu bao nhiêu — báo "lỗi tồn kho" chung chung thì kho không biết làm gì.
    const thieu: string[] = [];
    for (const d of dong) {
      const kd = await tonKhaDung(d.sku, d.kho);
      if (kd < d.soLuong) thieu.push(`${d.sku} tại ${d.kho}: cần ${d.soLuong}, còn ${kd}`);
    }
    return {
      ok: false,
      loi: thieu.length
        ? `Không đủ tồn để giữ chỗ — ${thieu.join('; ')}. Nhận hàng vào kho trước rồi chốt lại.`
        : 'Chốt đơn thất bại, tồn kho vừa đổi. Thử lại.',
    };
  }
  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${don.ma}`);
  return { ok: true };
}

/**
 * Lùi đơn đã chốt về nháp để sửa dòng hàng. Nếu đang giữ chỗ tồn thì trả lại
 * chỗ đã giữ trong cùng transaction trước khi đổi trạng thái.
 */
export async function luiVeNhap(donId: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const [don] = await db.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId));
  if (!don) return { ok: false, loi: 'Không tìm thấy đơn.' };
  if (!chuyenDuoc(don.trangThai, 'nhap')) {
    return { ok: false, loi: `Đơn đang ở trạng thái ${don.trangThai}, không lùi về nháp được.` };
  }
  const dong = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));

  await db.transaction(async (tx) => {
    if (don.trangThai === 'da_chot') {
      for (const d of dong) {
        await applyMovement(tx, draftTraCho({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
      }
    }
    await tx.update(schema.kolDon)
      .set({ trangThai: 'nhap', suaLuc: new Date(), suaBoi: actor })
      .where(eq(schema.kolDon.id, donId));
  });

  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${don.ma}`);
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

  const [don] = await db.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId));
  if (!don) return { ok: false, loi: 'Không tìm thấy đơn.' };
  if (!chuyenDuoc(don.trangThai, 'da_gui')) {
    return { ok: false, loi: `Đơn đang ở trạng thái ${don.trangThai}, không gửi được.` };
  }
  const dong = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));
  const luc = new Date();
  // Giờ NGHIỆP VỤ, không phải UTC. lib/timezone.ts ghi số đo thật: quy theo UTC thì
  // 36,6% đơn lệch ngày và 91 đơn lệch hẳn THÁNG. Chọn sai ngày ở đây là chọn sai
  // dòng giá vốn, rồi con số đó đông cứng vĩnh viễn vào chi phí marketing.
  const ngayGui = ngayKinhDoanh(luc)!;

  await db.transaction(async (tx) => {
    for (const d of dong) {
      await applyMovement(tx, draftXuat({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
      // Đông cứng giá vốn. Dòng người dùng đã gõ tay thì GIỮ NGUYÊN, không đè.
      if (d.giaVon == null) {
        const ds = await tx.select({
          costPerUnit: schema.skuCosts.costPerUnit,
          currency: schema.skuCosts.currency,
          effectiveFrom: schema.skuCosts.effectiveFrom,
          storeId: schema.skuCosts.storeId,
        }).from(schema.skuCosts).where(eq(schema.skuCosts.sku, d.sku));
        // sku_costs khoá theo (store_id, sku, effective_from) — MỘT mã hàng có thể
        // có giá ở nhiều cửa hàng. Đo 23/09/2026: hiện 0 mã nào như vậy, nhưng đã
        // có HAI cửa hàng cùng ghi giá (meanblvd 4.109 dòng, tinhatelier 6 dòng).
        // Nhập nhằng thì ĐỂ NULL cho người dùng gõ tay, không bốc giá của cửa hàng
        // khác gán vào hàng của mình — đúng cách đã xử lý ở việc mã vạch.
        const soStore = new Set(ds.map((x) => x.storeId)).size;
        const g = soStore > 1 ? null : chonGiaVon(ds, ngayGui);
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
  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${don.ma}`);
  return { ok: true };
}

/**
 * Huỷ đơn. Đang `nhap` thì huỷ thẳng, không đụng tồn. Đang `da_chot` thì trả
 * lại chỗ tồn đã giữ trong cùng transaction rồi mới đổi trạng thái. `da_gui`
 * không huỷ được — hàng đã đi thì đường về là hàng trả, không phải huỷ đơn.
 */
export async function huyDon(donId: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const [don] = await db.select().from(schema.kolDon).where(eq(schema.kolDon.id, donId));
  if (!don) return { ok: false, loi: 'Không tìm thấy đơn.' };
  if (!chuyenDuoc(don.trangThai, 'huy')) {
    return { ok: false, loi: `Đơn đang ở trạng thái ${don.trangThai}, không huỷ được.` };
  }
  const dong = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.donId, donId));

  await db.transaction(async (tx) => {
    if (don.trangThai === 'da_chot') {
      for (const d of dong) {
        await applyMovement(tx, draftTraCho({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, actor));
      }
    }
    await tx.update(schema.kolDon)
      .set({ trangThai: 'huy', suaLuc: new Date(), suaBoi: actor })
      .where(eq(schema.kolDon.id, donId));
  });

  revalidatePath('/f/kol');
  revalidatePath(`/f/kol/${don.ma}`);
  return { ok: true };
}

/** Nhận hàng mượn về: ghi lần trả, cộng dồn số đã trả, cộng tồn nếu nhập lại kho. */
export async function nhanTraVe(fd: FormData): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requireQuanLyKol();
  const dongId = String(fd.get('dongId') ?? '');
  const soLuong = Number(fd.get('soLuong') ?? 0);
  const nhapLaiKho = fd.get('nhapLaiKho') === '1';
  const lyDo = (fd.get('lyDoKhongNhap') as string | null) ?? null;

  const [d] = await db.select().from(schema.kolDongDon).where(eq(schema.kolDongDon.id, dongId));
  if (!d) return { ok: false, loi: 'Không tìm thấy dòng hàng.' };

  const kiem = kiemTraVe(
    { id: d.id, sku: d.sku, tenHang: d.tenHang, kho: d.kho, soLuong: d.soLuong, hinhThuc: d.hinhThuc,
      hanTra: d.hanTra, giaVon: d.giaVon, giaVonTienTe: d.giaVonTienTe,
      soLuongDaTra: d.soLuongDaTra, soLuongNhapLai: d.soLuongNhapLai },
    soLuong, nhapLaiKho, lyDo,
  );
  if (!kiem.ok) return { ok: false, loi: kiem.loi };

  await db.transaction(async (tx) => {
    await tx.insert(schema.kolTraVe).values({
      dongDonId: dongId, soLuong, nhapLaiKho,
      lyDoKhongNhap: nhapLaiKho ? null : lyDo, taoBoi: actor,
    });
    await tx.update(schema.kolDongDon).set({
      soLuongDaTra: d.soLuongDaTra + soLuong,
      // Chỉ phần NHẬP LẠI mới rời khỏi chi phí. Hàng về mà hỏng vẫn là tiền đã tiêu.
      soLuongNhapLai: nhapLaiKho ? d.soLuongNhapLai + soLuong : d.soLuongNhapLai,
    }).where(eq(schema.kolDongDon.id, dongId));
    if (nhapLaiKho) {
      await applyMovement(tx, draftNhapLai({ id: d.id, sku: d.sku, kho: d.kho, soLuong: d.soLuong }, soLuong, actor));
    }
  });
  revalidatePath('/f/kol');
  return { ok: true };
}
