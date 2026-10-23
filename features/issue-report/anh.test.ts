import { describe, expect, it } from 'vitest';
import { khoaAnh, nhanDangAnh, tenHienThi } from './anh';

const bytes = (...v: number[]) => new Uint8Array([...v, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('nhanDangAnh', () => {
  it('nhận PNG / JPEG / GIF / WebP theo byte đầu', () => {
    expect(nhanDangAnh(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))?.loai).toBe('image/png');
    expect(nhanDangAnh(bytes(0xff, 0xd8, 0xff, 0xe0))?.loai).toBe('image/jpeg');
    expect(nhanDangAnh(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61))?.loai).toBe('image/gif');
    expect(nhanDangAnh(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))?.loai).toBe('image/webp');
  });
  it('từ chối SVG, HTML, tệp rỗng — dù tên có đuôi ảnh', () => {
    expect(nhanDangAnh(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(nhanDangAnh(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
    expect(nhanDangAnh(new Uint8Array())).toBeNull();
  });
  it('RIFF nhưng không phải WebP (vd. WAV) bị từ chối', () => {
    expect(nhanDangAnh(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))).toBeNull();
  });
});

describe('tenHienThi / khoaAnh', () => {
  it('bỏ đường dẫn và ký tự điều khiển', () => {
    expect(tenHienThi('../../etc/passwd')).toBe('passwd');
    expect(tenHienThi('C:\\x\\loi\u0000.png')).toBe('loi.png');
    expect(tenHienThi('   ')).toBe('anh');
  });
  it('khoá S3 chỉ từ id + thứ tự + đuôi hệ thống đặt', () => {
    expect(khoaAnh('abc', 2, 'png')).toBe('issue-reports/abc/2.png');
  });
});
