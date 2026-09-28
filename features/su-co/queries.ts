'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { getSignedDownloadUrl } from '@/lib/storage/s3';
import {
  gomTheoBoPhan, gomTheoLoai, gomTheoNguyenNhan, tongTatCa,
  type DongChiPhi, type NhomThietHai,
} from './tong-hop';
import type { ChiTietSuCo, DongSuCo, LocSuCo } from './types';
import type { TongTheoTien } from '@/features/dispute/tong-tien';

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/** Dòng chi phí gom sẵn bằng `json_agg` — tránh N+1 khi hiện danh sách. */
const CHON = sql`
  s.id, s.ma_su_co, s.ngay_bao, s.nguyen_nhan, s.giai_doan, s.trang_thai, s.mo_ta,
  s.bo_phan_chinh, s.ma_giam_gia, s.ma_ticket_cs, s.ma_don, s.order_id,
  s.can_xem_lai, s.lark_record_id, s.anh_keys,
  st.name AS store,
  COALESCE((SELECT json_agg(json_build_object(
      'id', c.id, 'loai', c.loai, 'soTien', c.so_tien, 'tienTe', c.tien_te,
      'boPhan', c.bo_phan) ORDER BY c.so_tien DESC)
    FROM su_co_chi_phi c WHERE c.su_co_id = s.id), '[]'::json) AS chi_phi`;

function doiDong(x: Record<string, unknown>): DongSuCo {
  return {
    id: String(x.id),
    maSuCo: String(x.ma_su_co),
    ngayBao: String(x.ngay_bao),
    nguyenNhan: String(x.nguyen_nhan),
    giaiDoan: (x.giai_doan as string) ?? null,
    trangThai: String(x.trang_thai),
    moTa: (x.mo_ta as string) ?? null,
    boPhanChinh: (x.bo_phan_chinh as string) ?? null,
    maGiamGia: (x.ma_giam_gia as string) ?? null,
    maTicketCs: (x.ma_ticket_cs as string) ?? null,
    store: (x.store as string) ?? null,
    maDon: (x.ma_don as string) ?? null,
    coDonTrongHeThong: x.order_id != null,
    canXemLai: Boolean(x.can_xem_lai),
    nguonLark: x.lark_record_id != null,
    soAnh: ((x.anh_keys as string[]) ?? []).length,
    chiPhi: (x.chi_phi as DongSuCo['chiPhi']) ?? [],
  };
}

export async function danhSachSuCo(loc: LocSuCo = {}): Promise<DongSuCo[]> {
  await requirePerm('view_cx_incident');
  const r = await db.execute(sql`
    SELECT ${CHON}
    FROM su_co s LEFT JOIN stores st ON st.id = s.store_id
    WHERE (${loc.trangThai ?? null}::text IS NULL OR s.trang_thai = ${loc.trangThai ?? null})
      AND (${loc.nguyenNhan ?? null}::text IS NULL OR s.nguyen_nhan = ${loc.nguyenNhan ?? null})
      AND (${loc.canXemLai ?? false} = false OR s.can_xem_lai = true)
      -- Lọc theo bộ phận phải tính CẢ dòng chi phí tự khai bộ phận, không chỉ
      -- bộ phận chính: sự cố do Procurement gây ra vẫn có thể có một khoản của Kho.
      AND (${loc.boPhan ?? null}::text IS NULL
           OR s.bo_phan_chinh = ${loc.boPhan ?? null}
           OR EXISTS (SELECT 1 FROM su_co_chi_phi c
                      WHERE c.su_co_id = s.id AND c.bo_phan = ${loc.boPhan ?? null}))
    ORDER BY s.ngay_bao DESC, s.created_at DESC
    LIMIT 500`);
  return rows<Record<string, unknown>>(r).map(doiDong);
}

export interface TongHopThietHai {
  tong: TongTheoTien[];
  theoBoPhan: NhomThietHai[];
  theoLoai: NhomThietHai[];
  theoNguyenNhan: NhomThietHai[];
  soSuCo: number;
  soCanXemLai: number;
}

/**
 * Tổng hợp thiệt hại. Đọc PHẲNG các dòng chi phí rồi gom bằng hàm thuần
 * `tong-hop.ts` — quy tắc quy bộ phận chỉ viết một chỗ, và có test chứng minh
 * không cộng trùng.
 */
export async function tongHopThietHai(): Promise<TongHopThietHai> {
  await requirePerm('view_cx_incident');
  const r = await db.execute(sql`
    SELECT c.su_co_id, c.loai, c.so_tien, c.tien_te, c.bo_phan,
           s.bo_phan_chinh, s.nguyen_nhan
    FROM su_co_chi_phi c JOIN su_co s ON s.id = c.su_co_id`);
  const dong: DongChiPhi[] = rows<Record<string, unknown>>(r).map((x) => ({
    suCoId: String(x.su_co_id),
    loai: String(x.loai),
    soTien: String(x.so_tien),
    tienTe: String(x.tien_te),
    boPhan: (x.bo_phan as string) ?? null,
    boPhanChinh: (x.bo_phan_chinh as string) ?? null,
    nguyenNhan: String(x.nguyen_nhan),
  }));

  const [d] = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT count(*)::int AS so, count(*) FILTER (WHERE can_xem_lai)::int AS xem_lai
    FROM su_co`));

  return {
    tong: tongTatCa(dong),
    theoBoPhan: gomTheoBoPhan(dong),
    theoLoai: gomTheoLoai(dong),
    theoNguyenNhan: gomTheoNguyenNhan(dong),
    soSuCo: Number(d?.so ?? 0),
    soCanXemLai: Number(d?.xem_lai ?? 0),
  };
}

export async function chiTietSuCo(id: string): Promise<ChiTietSuCo | null> {
  await requirePerm('view_cx_incident');
  const x = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT ${CHON}, s.created_at, s.dong_luc, u.name AS ten_nguoi_tao
    FROM su_co s
    LEFT JOIN stores st ON st.id = s.store_id
    LEFT JOIN "user" u ON u.id = s.tao_boi
    WHERE s.id = ${id}::uuid`))[0];
  if (!x) return null;

  const gc = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT g.id, g.noi_dung, g.tu_lark, g.created_at, u.name AS ten
    FROM su_co_ghi_chu g LEFT JOIN "user" u ON u.id = g.tao_boi
    WHERE g.su_co_id = ${id}::uuid ORDER BY g.created_at`));

  // Ký URL từng ảnh; key lỗi (file đã xoá, storage tạm lỗi) thì bỏ qua chứ không
  // làm sập cả modal.
  const anhUrls: string[] = [];
  for (const key of ((x.anh_keys as string[]) ?? [])) {
    try {
      anhUrls.push(await getSignedDownloadUrl(key));
    } catch {
      // bỏ qua key lỗi
    }
  }

  return {
    ...doiDong(x),
    anhUrls,
    tenNguoiTao: (x.ten_nguoi_tao as string) ?? null,
    taoLuc: new Date(x.created_at as string),
    dongLuc: x.dong_luc ? new Date(x.dong_luc as string) : null,
    ghiChu: gc.map((g) => ({
      id: String(g.id),
      noiDung: String(g.noi_dung),
      tenNguoiGhi: (g.ten as string) ?? null,
      tuLark: Boolean(g.tu_lark),
      taoLuc: new Date(g.created_at as string),
    })),
  };
}
