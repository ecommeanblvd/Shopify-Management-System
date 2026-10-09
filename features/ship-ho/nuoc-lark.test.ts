import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { countryNameToIso } from '@/features/shipments/country-name-to-iso';

const NGUON = readFileSync(new URL('./sync-lark-don.ts', import.meta.url), 'utf8');

/**
 * Ô Quốc gia trên bảng Lark ship hộ là chữ TỰ DO. Đơn `26-INSLG-SV-0123` mang
 * `"United Arab Aramex"` — ai đó gõ tên HÃNG vào ô quốc gia. Engine cước đòi ISO-2 nên mọi lượt
 * re-quote trả `bad_input`, đơn không có giá, bảng kê loại nó ra: kiện đã gửi, đã thu
 * 199.581đ thuế của brand, mà chưa bao giờ tính cước (~1.455.976đ). Nằm im gần một tháng.
 */
describe('đồng bộ đơn ship hộ từ Lark: ô Quốc gia', () => {
  it('chuẩn hoá về ISO-2 ở MỌI chỗ ghi, không ghi thẳng chữ tự do', () => {
    // Không còn chỗ nào ghi `d.nuoc!` trần vào `country`.
    expect(NGUON).not.toMatch(/country: d\.nuoc!/);
    const soChoChuanHoa = (NGUON.match(/countryNameToIso\(d\.nuoc\) \?\? d\.nuoc!/g) ?? []).length;
    expect(soChoChuanHoa).toBe(2); // một chỗ ghi CSDL, một chỗ dựng payload gửi MMP
  });

  /* Giữ chữ gốc khi không đọc được: cột `country` là NOT NULL, và xoá thứ người đã gõ là tệ
     hơn — mất luôn manh mối để sửa. Nhưng phải GHI LẠI, vì im lặng là cách lỗi này sống một
     tháng. */
  it('không đọc được thì giữ nguyên chữ gốc VÀ ghi vào kết quả lượt chạy', () => {
    expect(NGUON).toMatch(/nuocKhongDocDuoc/);
    expect(NGUON).toMatch(/countryNameToIso\(d\.nuoc\) == null/);
  });
});

describe('countryNameToIso với chính chuỗi đã gây lỗi', () => {
  /* KHÔNG được đoán mò: "United Arab Aramex" gần giống "United Arab Emirates", nhưng đoán sai
     quốc gia là tính cước sai tuyến và không ai biết. Trả null để có người nhìn. */
  it('"United Arab Aramex" → null, KHÔNG tự đoán thành AE', () => {
    expect(countryNameToIso('United Arab Aramex')).toBeNull();
  });

  it('các dạng hợp lệ vẫn đọc đúng', () => {
    expect(countryNameToIso('AE')).toBe('AE');
    expect(countryNameToIso('ae')).toBe('AE');
    expect(countryNameToIso('United Arab Emirates')).toBe('AE');
    expect(countryNameToIso('Saudi Arabia,Saudi Arabia')).toBe('SA');
  });
});
