/**
 * THUẦN: gom thiệt hại sự cố theo bộ phận / loại chi phí / nguyên nhân.
 *
 * File này tồn tại vì một con số cụ thể: cộng tiền theo bộ phận trên bảng Lark ra
 * **46.791** trong khi tổng thật là **42.601** — ca có hai bộ phận thì số tiền bị
 * tính cho cả hai. Ở đây mỗi đồng thuộc đúng MỘT dòng chi phí, và dòng thuộc đúng
 * MỘT bộ phận, nên tổng theo bộ phận luôn bằng tổng thật.
 *
 * Mọi số tách theo đơn vị tiền — dùng lại `gomTheoTienTe` của module tranh chấp
 * thay vì viết lại, vì hàm đó đã có test cho ca nhiều đơn vị tiền.
 */
import { gomTheoTienTe, type TongTheoTien } from '@/features/dispute/tong-tien';

export interface DongChiPhi {
  suCoId: string;
  loai: string;
  soTien: string | number;
  tienTe: string;
  /** Bộ phận của riêng dòng này; trống thì thừa hưởng `boPhanChinh` của sự cố. */
  boPhan: string | null;
  /** Bộ phận chịu chính của sự cố chứa dòng này. */
  boPhanChinh: string | null;
  /** Nguyên nhân của sự cố chứa dòng này. */
  nguyenNhan: string;
}

export interface NhomThietHai {
  khoa: string;
  /** Số SỰ CỐ khác nhau, không phải số dòng chi phí. */
  soSuCo: number;
  soDong: number;
  tong: TongTheoTien[];
}

/**
 * Bộ phận chịu một dòng chi phí. Quy tắc viết MỘT LẦN ở đây để không nơi nào tự
 * suy lại: dòng tự khai thì theo dòng, không thì theo bộ phận chính của sự cố.
 */
export function boPhanChiu(d: DongChiPhi): string | null {
  return d.boPhan ?? d.boPhanChinh;
}

function gom(dong: DongChiPhi[], khoaCua: (d: DongChiPhi) => string | null): NhomThietHai[] {
  const m = new Map<string, { dong: DongChiPhi[]; suCo: Set<string> }>();
  for (const d of dong) {
    // Không có khoá thì vào nhóm rỗng có tên rõ ràng, KHÔNG bỏ đi: 29/156 ca của
    // Lark không ghi bộ phận mà vẫn mang 8.523 tiền — bỏ chúng là mất 20% thiệt hại.
    const k = khoaCua(d) ?? '(chưa ghi)';
    const cur = m.get(k) ?? { dong: [], suCo: new Set<string>() };
    cur.dong.push(d);
    cur.suCo.add(d.suCoId);
    m.set(k, cur);
  }
  return [...m].map(([khoa, v]) => ({
    khoa,
    soSuCo: v.suCo.size,
    soDong: v.dong.length,
    tong: gomTheoTienTe(v.dong.map((d) => ({ soTien: d.soTien, tienTe: d.tienTe }))),
  })).sort((a, b) => (b.tong[0]?.tong ?? 0) - (a.tong[0]?.tong ?? 0));
}

export function gomTheoBoPhan(dong: DongChiPhi[]): NhomThietHai[] {
  return gom(dong, boPhanChiu);
}

export function gomTheoLoai(dong: DongChiPhi[]): NhomThietHai[] {
  return gom(dong, (d) => d.loai);
}

export function gomTheoNguyenNhan(dong: DongChiPhi[]): NhomThietHai[] {
  return gom(dong, (d) => d.nguyenNhan);
}

/** Tổng toàn bộ, tách theo đơn vị tiền — mốc để đối chiếu các bảng nhóm. */
export function tongTatCa(dong: DongChiPhi[]): TongTheoTien[] {
  return gomTheoTienTe(dong.map((d) => ({ soTien: d.soTien, tienTe: d.tienTe })));
}
