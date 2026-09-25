/**
 * THUẦN: luật nhận file DÁN TỪ CLIPBOARD (CEO 25/09).
 *
 * Nhân sự kho copy thẳng ảnh từ Zalo rồi dán vào hệ thống, không lưu ra máy rồi
 * mới chọn file. Ảnh dán từ clipboard KHÔNG mang tên gốc — trình duyệt đặt cho
 * cái tên trống hoặc "image.png" y hệt nhau ở mọi lượt dán. Dán năm tấm là năm
 * file cùng tên, nhìn danh sách không biết cái nào là cái nào, nên phải tự đặt
 * tên có dấu thời gian.
 */

/** Chỉ nhận ảnh và PDF — biên bản brand đưa thường là ảnh chụp hoặc bản scan. */
export function chapNhanKieu(type: string): boolean {
  return type.startsWith('image/') || type === 'application/pdf';
}

const DUOI: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf',
};

/** Tên đặt cho file dán: có loại, có mốc thời gian đến giây, có số thứ tự. */
export function tenFileDan(loai: string, type: string, luc: Date, thuTu = 1): string {
  const d = [
    luc.getFullYear(), String(luc.getMonth() + 1).padStart(2, '0'),
    String(luc.getDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(luc.getHours()).padStart(2, '0'), String(luc.getMinutes()).padStart(2, '0'),
    String(luc.getSeconds()).padStart(2, '0'),
  ].join('');
  return `${loai}-${d}-${thuTu}.${DUOI[type] ?? 'bin'}`;
}
