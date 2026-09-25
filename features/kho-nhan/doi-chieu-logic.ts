/**
 * THUẦN: so danh sách chiếc bên mình với các dòng trên bảng Lark của CÙNG một
 * ngày nhập, chỉ ra ba loại lệch.
 *
 * CEO 24/09: "bảng thông tin đi đơn này trên Lark và trên UI phải khớp nhau y
 * hệt". Khớp hay không thì phải ĐO mới biết, nên đây là phép đo đó.
 */

export interface ChiecCuaMinh {
  unitCode: string;
  maDon: string | null;
  sku: string | null;
  larkRecordId: string | null;
}

export interface DongLark {
  recordId: string;
  maDon: string | null;
  sku: string | null;
}

export interface KetQuaDoiChieu {
  /** Chiếc bên mình CHƯA từng gửi — Lark hoàn toàn không biết món này. */
  chuaGui: ChiecCuaMinh[];
  /** Chiếc bên mình ghi là đã gửi, nhưng record đó KHÔNG CÒN trên Lark. */
  matTrenLark: ChiecCuaMinh[];
  /** Dòng trên Lark mà hệ thống không có. Bình thường trong giai đoạn chạy
   *  song song — đội kho vẫn nhập tay thẳng lên Lark. */
  chiCoTrenLark: DongLark[];
  khop: number;
}

export function doiChieu(
  cuaMinh: readonly ChiecCuaMinh[], tuLark: readonly DongLark[],
): KetQuaDoiChieu {
  const idLark = new Set(tuLark.map((d) => d.recordId));
  const daDung = new Set<string>();

  const chuaGui: ChiecCuaMinh[] = [];
  const matTrenLark: ChiecCuaMinh[] = [];
  let khop = 0;

  for (const c of cuaMinh) {
    if (!c.larkRecordId) { chuaGui.push(c); continue; }
    if (idLark.has(c.larkRecordId)) { khop += 1; daDung.add(c.larkRecordId); continue; }
    // Có id mà Lark không còn dòng: ai đó xoá thẳng trên Lark, hoặc mình ghi id
    // rồi record bị dọn. Đây là loại lệch ÂM THẦM nhất — không lần nào báo lỗi.
    matTrenLark.push(c);
  }

  return {
    chuaGui,
    matTrenLark,
    chiCoTrenLark: tuLark.filter((d) => !daDung.has(d.recordId)),
    khop,
  };
}

/** Có lệch nào đáng để người xem phải xử lý không. */
export function coLech(k: KetQuaDoiChieu): boolean {
  return k.chuaGui.length > 0 || k.matTrenLark.length > 0 || k.chiCoTrenLark.length > 0;
}
