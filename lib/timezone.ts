/**
 * Múi giờ NGHIỆP VỤ của công ty.
 *
 * Database lưu mọi mốc thời gian ở UTC (đúng), nhưng nghiệp vụ tính theo giờ
 * Việt Nam: "đơn ngày 31/03" nghĩa là 31/03 giờ Việt Nam, không phải giờ UTC.
 * Hai thứ đó lệch nhau 7 tiếng, nên đơn đặt buổi tối rơi sang ngày hôm trước
 * theo UTC — và đơn cuối tháng nhảy hẳn sang tháng trước.
 *
 * Đo ngày 04/09/2026 trên dữ liệu thật: **hơn 1/3 số đơn bị lệch ngày** nếu quy
 * theo UTC (MEAN 2.725/7.450 = 36,6% · Tinh 466/1.331 = 35,0%), trong đó 91 đơn
 * MEAN và 16 đơn Tinh lệch hẳn THÁNG — tức doanh thu tháng và đối soát bị sai.
 *
 * Cửa hàng Shopify khai múi giờ Asia/Bangkok; Asia/Ho_Chi_Minh cùng UTC+7 và
 * đều không có giờ mùa hè nên hai tên gọi tương đương. Dùng MỘT hằng số duy
 * nhất để không bao giờ phải hỏi "chỗ này đang theo giờ nào".
 */
export const MUI_GIO_KINH_DOANH = 'Asia/Bangkok';

/**
 * Mảnh SQL quy một cột timestamp (lưu UTC, kiểu `timestamp` không múi giờ) về
 * giờ nghiệp vụ.
 *
 * Phải là HAI bước `AT TIME ZONE`: bước đầu gắn nhãn UTC cho giá trị naive,
 * bước sau đổi sang giờ Việt Nam. Viết một bước (`col AT TIME ZONE 'Asia/Bangkok'`)
 * là SAI NGƯỢC — nó hiểu giá trị đang là giờ Bangkok rồi đổi sang UTC.
 */
export function sqlGioKinhDoanh(cot: string): string {
  return `(${cot} AT TIME ZONE 'UTC' AT TIME ZONE '${MUI_GIO_KINH_DOANH}')`;
}

/** 'YYYY-MM-DD' theo giờ nghiệp vụ. */
export function ngayKinhDoanh(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  // en-CA cho ra đúng dạng YYYY-MM-DD.
  return dt.toLocaleDateString('en-CA', { timeZone: MUI_GIO_KINH_DOANH });
}

/** 'YYYY-MM' theo giờ nghiệp vụ — dùng để gom báo cáo theo tháng. */
export function thangKinhDoanh(d: Date | string | null | undefined): string | null {
  return ngayKinhDoanh(d)?.slice(0, 7) ?? null;
}

/** Ngày giờ hiển thị cho người Việt, theo giờ nghiệp vụ. */
export function hienNgayGio(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('vi-VN', { timeZone: MUI_GIO_KINH_DOANH });
}

/** Chỉ ngày, dạng dd/MM/yyyy theo giờ nghiệp vụ. */
export function hienNgay(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('vi-VN', { timeZone: MUI_GIO_KINH_DOANH });
}

/**
 * THUẦN: dịch một ngày lịch 'YYYY-MM-DD' đi `buoc` ngày. KHÔNG đụng múi giờ.
 *
 * Vì sao phải có hàm riêng: cách viết quen tay
 *   `const x = new Date(`${ngay}T00:00:00`); x.setDate(x.getDate() + b);`
 *   `x.toISOString().slice(0, 10)`
 * SAI ở Việt Nam — `new Date('…T00:00:00')` đọc theo giờ ĐỊA PHƯƠNG (UTC+7) còn
 * `toISOString()` trả về UTC, nên mất 7 tiếng và rơi về NGÀY TRƯỚC. Nút chuyển
 * ngày của Sổ nhập vì vậy lùi từ Thứ Ba 29/09 ra thẳng Chủ Nhật 27/09, rồi bấm
 * tiến thì đứng im vì 27/09 + 1 cũng ra 27/09 (CEO báo 29/09/2026).
 *
 * Ở đây dùng UTC cho CẢ hai đầu (dựng và đọc) nên phép cộng ngày là phép cộng
 * lịch thuần tuý, đúng qua biên tháng, biên năm và năm nhuận.
 */
export function dichNgay(ngay: string, buoc: number): string {
  const [y, m, d] = ngay.split('-').map(Number);
  if (!y || !m || !d) return ngay;
  const t = new Date(Date.UTC(y, m - 1, d) + buoc * 86_400_000);
  const hai = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${hai(t.getUTCMonth() + 1)}-${hai(t.getUTCDate())}`;
}
