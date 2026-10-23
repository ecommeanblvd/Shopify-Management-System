/**
 * Ảnh đính kèm báo lỗi. Thuần logic (không I/O) để test được.
 *
 * Nhận dạng bằng BYTE ĐẦU TỆP, không tin `file.type` hay đuôi tên: cả hai do trình duyệt/người
 * dùng khai. Chỉ cho PNG/JPEG/WebP/GIF — cố ý KHÔNG nhận SVG vì SVG chạy được script khi mở
 * trực tiếp trên domain của app.
 */
export const ANH_TOI_DA = 3;
export const ANH_BYTE_TOI_DA = 4 * 1024 * 1024;

export interface AnhBaoLoi {
  key: string;
  ten: string;
  loai: string;
  kichThuoc: number;
}

export function nhanDangAnh(b: Uint8Array): { loai: string; duoi: string } | null {
  const bang = (...v: number[]) => v.every((x, i) => b[i] === x);
  if (b.length >= 8 && bang(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { loai: 'image/png', duoi: 'png' };
  if (b.length >= 3 && bang(0xff, 0xd8, 0xff)) return { loai: 'image/jpeg', duoi: 'jpg' };
  if (b.length >= 6 && bang(0x47, 0x49, 0x46, 0x38)) return { loai: 'image/gif', duoi: 'gif' };
  if (b.length >= 12 && bang(0x52, 0x49, 0x46, 0x46)
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { loai: 'image/webp', duoi: 'webp' };
  }
  return null;
}

/** Tên hiển thị: bỏ đường dẫn, bỏ ký tự điều khiển, cắt độ dài. Không dùng làm khoá S3. */
export function tenHienThi(ten: string): string {
  const goc = ten.split(/[\\/]/).pop() ?? '';
  const sach = goc.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return sach || 'anh';
}

/** Khoá S3 do HỆ THỐNG đặt từ id + số thứ tự — không bao giờ dùng tên người dùng đưa. */
export function khoaAnh(idBaoLoi: string, thuTu: number, duoi: string): string {
  return `issue-reports/${idBaoLoi}/${thuTu}.${duoi}`;
}
