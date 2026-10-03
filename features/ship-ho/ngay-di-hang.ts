/**
 * THUẦN: ngày hàng THẬT SỰ rời kho, và con số đó đến từ đâu. Không I/O.
 *
 * `shipped_at` là lúc Đức gõ trên Lark; `picked_up_at` là mốc hãng quét lấy hàng. Hai mốc lệch
 * nhau tới 3 ngày (AWB 873918787369: tạo nhãn 03/07, lấy hàng 06/07), mà phụ phí xăng dầu tính
 * theo TUẦN CỦA NGÀY ĐI — nên lấy nhầm mốc là tra nhầm tuần.
 *
 * Trả CẢ ngày lẫn nguồn trong một lượt: nguồn suy được từ `pickedUpAt == null` nên KHÔNG lưu
 * thành cột riêng, nhưng người đọc bảng kê vẫn cần biết, nên phải trả ra đây — thay vì để mỗi
 * nơi tự suy lại (hai bản sao của một luật là hẹn ngày chúng lệch — D-201).
 */
export type NguonNgayDi = 'hang' | 'lark';

export interface DonCoNgay {
  pickedUpAt: Date | string | null;
  shippedAt: string | null;
}

/**
 * `YYYY-MM-DD` theo giờ ĐỊA PHƯƠNG.
 *
 * Không dùng `toISOString()`: nó quy sang UTC, nên một mốc 00:30 giờ VN rơi về ngày hôm trước
 * — đúng lỗi đã làm lọt sạch tuần dầu hồi 02/10 (D-194).
 */
function ngayDiaPhuong(d: Date | string): string | null {
  const dt = typeof d === 'string' ? new Date(d.replace(' ', 'T')) : d;
  if (Number.isNaN(dt.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

export function ngayDiHang(d: DonCoNgay): { ngay: string | null; nguon: NguonNgayDi } {
  if (d.pickedUpAt != null) {
    const ngay = ngayDiaPhuong(d.pickedUpAt);
    if (ngay) return { ngay, nguon: 'hang' };
  }
  return { ngay: d.shippedAt ? d.shippedAt.slice(0, 10) : null, nguon: 'lark' };
}
