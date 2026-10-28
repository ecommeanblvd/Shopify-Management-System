/**
 * Phần THUẦN của lượt sửa đơn ship hộ bị gắn sai tài khoản hãng
 * (`scripts/du-lieu/sua-tai-khoan-hang-lech.ts`).
 *
 * Để ở đây vì đây là CHỐT AN TOÀN, không phải tiện ích đọc tham số: nó là thứ ngăn một lượt
 * `--ap-dung` quét cả lô. Chốt mà không có test thì chỉ là ý định.
 */

/**
 * Đọc danh sách mã đơn từ `--don a,b --don c`.
 *
 * Bỏ qua token bắt đầu bằng `--`: `--don --ap-dung` là người gõ thiếu mã, và coi `--ap-dung`
 * là một mã đơn thì lượt chạy sẽ không khớp gì — im lặng không sửa, đúng, nhưng chốt
 * `lyDoKhongApDung` lại tưởng đã có mã và cho đi. Nên chặn ngay ở đây.
 */
export function docDanhSachDon(argv: readonly string[]): string[] {
  const ra: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--don') continue;
    for (const m of (argv[i + 1] ?? '').split(',')) {
      const t = m.trim();
      if (t && !t.startsWith('--')) ra.push(t.toUpperCase());
    }
  }
  return ra;
}

/**
 * Lý do KHÔNG được áp dụng, hoặc `null` nếu được.
 *
 * Luật: `--ap-dung` một mình KHÔNG đủ — phải nêu tên từng đơn. Lệch hãng là hai nguồn trong
 * một dòng đá nhau; chọn bên nào là việc của người biết đơn đó đi hãng nào thật. Và một đơn đã
 * lên bảng kê thì tiền đã gửi brand, đổi tài khoản là chuyện kế toán, không phải chuyện sửa dữ
 * liệu — nên cũng phải nêu tên.
 */
export function lyDoKhongApDung(apDung: boolean, chon: readonly string[]): string | null {
  if (!apDung) return null;
  if (chon.length === 0) {
    return '--ap-dung phải đi kèm --don <mã đơn>. Lệch hãng sửa từng đơn, có người xác nhận.';
  }
  return null;
}
