/**
 * Bind một JS `Date` vào cột Postgres `timestamp` KHÔNG múi giờ (naive) sao
 * cho kết quả không phụ thuộc múi giờ của tiến trình Node.
 *
 * `pg` (driver Postgres) serialise một `Date` bằng cách format nó theo múi
 * giờ LOCAL của tiến trình rồi Postgres đọc chuỗi đó vào cột `timestamp` —
 * cột `timestamp` (không phải `timestamptz`) BỎ offset khi parse. Nếu tiến
 * trình chạy với `TZ=Asia/Saigon` (UTC+7), `new Date('2026-08-01T00:00:00+07:00')`
 * (tức 2026-07-31T17:00:00Z) bị `pg` in ra `'2026-08-01 00:00:00'` (giờ local)
 * — Postgres bỏ luôn offset và lưu/so y nguyên chuỗi đó, tức LỆCH 7 GIỜ so
 * với instant thật. Trên máy `TZ=UTC` thì không lệch — cùng một dòng code
 * cho ra hai kết quả khác nhau tuỳ máy chạy, đây chính là bug đã đo được
 * (492 vs 495 đơn tháng 2026-08).
 *
 * Cách né: tự serialise `Date` thành chuỗi ISO theo UTC (không có hậu tố
 * `Z`) rồi ép kiểu `::timestamp` ngay trong SQL — `toISOString()` LUÔN quy
 * về UTC bất kể `TZ` tiến trình, nên chuỗi ra luôn đúng instant, độc lập
 * hoàn toàn với múi giờ máy chạy.
 */
export function mocUtcNaive(d: Date): string {
  return d.toISOString().replace('Z', '');
}
