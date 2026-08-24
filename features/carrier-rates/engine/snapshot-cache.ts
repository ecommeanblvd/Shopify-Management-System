/**
 * Bộ nhớ đệm trong tiến trình, có hạn dùng — dùng cho phần TĨNH của snapshot
 * carrier (bảng giá, zone, bậc cân, phụ phí).
 *
 * Vì sao cần: mỗi lượt khách bấm thanh toán, callback carrier-service nạp lại
 * toàn bộ bảng giá cho 5 carrier account — khoảng 5.000 dòng mỗi lượt. Đo
 * ngày 24/08: 21 lượt nạp trong 16 phút, ~2 triệu dòng/ngày, trong khi bảng
 * giá gần như không đổi giữa các lượt. Supabase tính tiền theo egress (D-025),
 * nên đọc lại dữ liệu không đổi là trả tiền cho cùng một thứ nhiều lần.
 *
 * KHÔNG đệm danh sách ODA: nó được lọc theo mã bưu chính của từng đơn nên mỗi
 * lượt một khác, và sau khi lọc chỉ còn vài dòng (D-027).
 *
 * Lưu ý về dữ liệu cũ: giá đổi thì phải gọi `xoa()` để đá mục đệm ra ngay,
 * đừng trông vào hạn dùng — ops sửa bảng giá rồi kiểm tra lại liền, thấy giá
 * cũ sẽ tưởng hệ thống hỏng.
 */
export type BoNhoDem<T> = {
  /** Lấy theo khoá; chưa có hoặc quá hạn thì gọi `nap` rồi giữ lại. */
  lay(khoa: string, nap: () => Promise<T>): Promise<T>;
  /** Bỏ một khoá, hoặc dọn sạch khi không truyền gì. */
  xoa(khoa?: string): void;
  soMuc(): number;
};

export function taoBoNhoDem<T>(opts: {
  ttlMs: number;
  /** Chốt chặn rò bộ nhớ khi khoá sinh ra không giới hạn. */
  sucChua?: number;
  /** Tiêm được để test không phải chờ thật. */
  dongHo?: () => number;
}): BoNhoDem<T> {
  const { ttlMs, sucChua = 64 } = opts;
  const dongHo = opts.dongHo ?? (() => Date.now());
  const kho = new Map<string, { giaTri: T; hetHan: number }>();
  // Gộp các lời gọi song song cùng khoá: 5 request checkout cùng lúc chỉ nên
  // nạp một lần, không phải 5.
  const dangNap = new Map<string, Promise<T>>();

  return {
    async lay(khoa, nap) {
      const co = kho.get(khoa);
      if (co && co.hetHan > dongHo()) return co.giaTri;

      const cho = dangNap.get(khoa);
      if (cho) return cho;

      const viec = nap()
        .then((giaTri) => {
          kho.set(khoa, { giaTri, hetHan: dongHo() + ttlMs });
          // Quá sức chứa: bỏ mục vào sớm nhất (Map giữ đúng thứ tự chèn).
          while (kho.size > sucChua) {
            const cuNhat = kho.keys().next();
            if (cuNhat.done) break;
            kho.delete(cuNhat.value);
          }
          return giaTri;
        })
        .finally(() => { dangNap.delete(khoa); });

      dangNap.set(khoa, viec);
      return viec;
    },
    xoa(khoa) {
      if (khoa === undefined) { kho.clear(); dangNap.clear(); return; }
      kho.delete(khoa);
      dangNap.delete(khoa);
    },
    soMuc: () => kho.size,
  };
}
