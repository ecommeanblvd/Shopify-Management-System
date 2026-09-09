import { describe, it, expect } from 'vitest';
import { chuanTenBrand, khopTenBrand } from './ten-brand';

describe('khopTenBrand', () => {
  it('chuẩn hoá bỏ dấu, gạch, khoảng trắng', () => { expect(chuanTenBrand('Linh Phùng')).toBe('linhphung'); expect(chuanTenBrand('Jenny K Tran | Divine')).toBe('jennyktrandivine'); });
  it('bằng nhau / tiền tố ≥ 4', () => {
    expect(khopTenBrand('Calista de Minh Thanh', 'calista-de-minh-thanh', 'Calista-de-minh-thanh')).toBe(true);
    expect(khopTenBrand('Eegen', 'eegen-studio', 'Eegen Studio')).toBe(true);
    expect(khopTenBrand('Lecia', 'lecia-rtw', 'Lecia Rtw')).toBe(true);
    expect(khopTenBrand('Lyp', 'lyp', 'Lyp')).toBe(true);
  });
  it('lệch 1 ký tự khi tên ≥ 8 (MADDY HATE ROSE ↔ Maddy Hates Rose)', () => {
    expect(khopTenBrand('MADDY HATE ROSE', 'maddy-hates-rose', 'Maddy Hates Rose')).toBe(true);
  });
  it('không khớp brand khác', () => {
    expect(khopTenBrand('White Chic', 'white-plan', 'White Plan')).toBe(false);
    expect(khopTenBrand('JENNY K TRAN | DIVINE', 'jenny-k-tran', 'Jenny K Tran')).toBe(false);
    expect(khopTenBrand('THÉSONG', 'the-soul', 'The Soul')).toBe(false);
    expect(khopTenBrand('Poem', 'poet', 'Poet')).toBe(false);
  });
});
