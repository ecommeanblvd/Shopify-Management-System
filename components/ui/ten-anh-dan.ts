/**
 * THUẦN: đặt tên cho ảnh vừa nhận, dùng cho ô dán/kéo thả ảnh (`ONhanAnh`).
 *
 * Ảnh copy từ Zalo / tin nhắn vào clipboard tới dưới tên `image.png` — hoặc không có tên gì.
 * Giữ nguyên là một loạt ảnh lỗi QC cùng tên `image.png` chồng nhau trong storage, và người đọc
 * về sau không phân biệt được chiếc nào. Nên đặt lại theo thời điểm.
 *
 * Ảnh người ta CHỌN từ máy thì GIỮ NGUYÊN tên: tên đó do người đặt, thường có nghĩa.
 */
export function datTenAnhDan(f: File, bayGio: number = Date.now()): File {
  if (f.name && f.name !== 'image.png') return f;
  /* Đuôi lấy từ MIME nhưng phải KIỂM, không lấy thẳng: `application/octet-stream` cho ra tên
   * `dan-123.octet-stream`, còn `image/svg+xml` cho ra `dan-123.svg+xml` — hai tên rác mà không
   * ai thấy cho tới lúc mở storage. Chỉ nhận đuôi ngắn thuần chữ-số của một kiểu `image/*`;
   * còn lại về `png`. GIỮ nguyên MIME gốc: đó là thứ máy chủ dùng để quyết, không phải cái đuôi. */
  const sub = f.type.toLowerCase().startsWith('image/') ? f.type.toLowerCase().slice(6) : '';
  const duoi = /^[a-z0-9]{2,5}$/.test(sub) ? (sub === 'jpeg' ? 'jpg' : sub) : 'png';
  return new File([f], `dan-${bayGio}.${duoi}`, { type: f.type });
}
