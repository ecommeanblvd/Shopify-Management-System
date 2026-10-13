/**
 * THUẦN: hình dữ liệu + cách đọc của BƯỚC XEM TRƯỚC khi ghi vận đơn (CEO 14/10/2026).
 *
 * Luồng cũ làm một mạch: dán mã → lưu → lấy giá → ghi Lark. Luồng mới chẻ làm hai, và module
 * này là ngôn ngữ chung của hai bước đó: action phân tích trả về `KetQuaPhanTichVanDon`, hộp
 * thoại xác nhận chỉ VẼ lại nó.
 *
 * Vì sao mọi câu chữ nằm ở đây chứ không trong `.tsx`: bộ test của repo không bắt `.tsx`
 * (xem `vitest.config.ts` → `include`), nên một câu "ô này sẽ ghi" viết trong component là
 * câu không ai canh. Mà đây đúng là chỗ không được sai: Lark KHÔNG CÓ UNDO, nhân sự là lá
 * chắn cuối trước khi ghi, và họ chỉ chặn được cái họ được thấy đúng.
 */
import type { DongXemTruoc, KetQuaXemTruoc } from '@/features/lark/ghi-nguoc/patch-gia-uoc-tinh';

/** Kết quả bước PHÂN TÍCH — chưa ghi gì cả, kể cả dấu `gia_uoc_tinh_ghi_luc`. */
export interface KetQuaPhanTichVanDon {
  /** Mã đã bóc từ chuỗi nhân sự dán (có thể là link theo dõi của hãng). */
  tracking: string;
  /** Nguồn giá sẽ dùng — để nhân sự biết số đến từ API hãng hay bảng giá nội bộ. */
  nguon: 'fedex-api' | 'ups-api' | 'bang-gia' | null;
  /** Bảng từng ô đích; `null` khi chưa dựng được (xem `lyDoTrong`). */
  xem: KetQuaXemTruoc | null;
  /** Vì sao không có bảng: chưa lấy được giá, kiện chưa có dòng Lark, dòng Lark đã bị xoá… */
  lyDoTrong: string | null;
  /** Cảnh báo PHẢI đọc trước khi xác nhận (lệch hãng, Lark giữ mã khác, khoản lạ…). */
  canhBao: string[];
}

/** Tiền VND cho người đọc. `null` = nguồn không nói gì, hiện `—` chứ KHÔNG hiện `0`:
 *  "không biết" và "bằng không" là hai việc khác nhau ở đây (xem gia-uoc-tinh.ts). */
export function vnd(n: number | null): string {
  return n == null ? '—' : `${n.toLocaleString('vi-VN')} đ`;
}

/**
 * Chia bảng thành ba nhóm theo đúng thứ tự nhân sự cần đọc:
 *   1. `seGhi` — việc sắp xảy ra, đọc kỹ nhất.
 *   2. `daCo` — ô Lark đã có số; không ghi, nhưng là chỗ phải vào Lark xem bằng mắt nếu lệch.
 *   3. `khongCo` — nguồn im hoặc trả 0; ô sẽ trống và đó KHÔNG phải lỗi.
 */
export function nhomXemTruoc(xem: KetQuaXemTruoc): {
  seGhi: DongXemTruoc[]; daCo: DongXemTruoc[]; khongCo: DongXemTruoc[];
} {
  return {
    seGhi: xem.dong.filter((d) => d.trangThai === 'se-ghi'),
    daCo: xem.dong.filter((d) => d.trangThai === 'da-co-so'),
    khongCo: xem.dong.filter((d) => d.trangThai === 'nguon-khong-co' || d.trangThai === 'bang-khong'),
  };
}

/** Câu "vì sao" của MỘT ô — người đọc phải hiểu được số phận của ô mà không cần hỏi ai. */
export function moTaODich(d: DongXemTruoc): string {
  switch (d.trangThai) {
    case 'se-ghi':
      return `ô Lark đang trống → sẽ ghi ${vnd(d.soNguon)}`;
    case 'da-co-so':
      return d.soLarkDangCo != null
        ? `Lark đã có ${vnd(d.soLarkDangCo)} → KHÔNG ghi đè (ước tính ${vnd(d.soNguon)})`
        : `Lark đang giữ dữ liệu không đọc được thành số (${d.larkKhongDocDuoc}) → KHÔNG ghi đè, vào Lark kiểm bằng mắt`;
    case 'bang-khong':
      return 'nguồn báo giá trả 0 → không ghi (ghi 0 là khoá ô ở 0 vĩnh viễn, hoá đơn thật sau này không vào được)';
    case 'nguon-khong-co':
      return 'nguồn báo giá không có khoản này → để trống, KHÔNG quy về 0';
  }
}

/** Câu "vì sao" của ô mã vận đơn trên Lark. */
export function moTaOTracking(o: KetQuaXemTruoc['oTracking']): string {
  switch (o.trangThai) {
    case 'se-ghi': return `ô Lark đang trống → sẽ ghi ${o.maSeGhi}`;
    case 'khop': return `Lark đã có đúng mã này (${o.maLarkDangCo}) → không ghi lại`;
    case 'lark-co-ma-khac':
      return `Lark đang giữ mã KHÁC (${o.maLarkDangCo}) → không ghi đè; lượt đồng bộ Lark kế tiếp sẽ ghi ${o.maLarkDangCo} trở lại, vào Lark sửa tay trước`;
    case 'khong-doc-duoc':
      return 'ô mã vận đơn trên Lark có dữ liệu không đọc được → không ghi đè, vào Lark kiểm bằng mắt';
    case 'khong-co-ma': return 'chưa có mã để ghi';
  }
}

/**
 * Một câu tóm tắt cho đầu hộp thoại xác nhận.
 *
 * Nói rõ "không ô nào" khi không còn gì để ghi: bấm xác nhận lúc đó vẫn CÓ tác dụng (mã vận
 * đơn vào CSDL, kiện rời hàng chờ) nên không được để người dùng tưởng nút không làm gì.
 */
export function cauTomTat(xem: KetQuaXemTruoc): string {
  const { seGhi, daCo } = nhomXemTruoc(xem);
  const soO = seGhi.length + (xem.oTracking.trangThai === 'se-ghi' ? 1 : 0);
  const dau = soO === 0
    ? 'Không ô nào trên Lark được ghi'
    : `Sẽ ghi ${soO} ô trên Lark`;
  return daCo.length === 0 ? `${dau}.` : `${dau}; ${daCo.length} ô đã có số từ trước nên không bị đè.`;
}

/**
 * Tên nguồn giá cho người đọc.
 *
 * Phải nói ra: số từ API hãng là giá hợp đồng đang hiệu lực, còn số từ bảng giá nội bộ là số
 * mình tự tính — hai mức đáng tin khác nhau, và nhân sự đang được giao việc soi số đó.
 */
export function tenNguon(nguon: KetQuaPhanTichVanDon['nguon']): string {
  switch (nguon) {
    case 'fedex-api': return 'API giá sống của FedEx';
    case 'ups-api': return 'API giá sống của UPS';
    case 'bang-gia': return 'bảng giá nội bộ';
    case null: return 'chưa rõ nguồn';
  }
}

/** Tổng ước tính sẽ ghi (hoặc đang có) — con số nhân sự soi đầu tiên. */
export function tongUocTinh(xem: KetQuaXemTruoc): number | null {
  const d = xem.dong.find((x) => x.khoan === 'total');
  return d?.soNguon ?? null;
}
