import { describe, expect, it } from 'vitest';
import { buildOrderNumberSearchBody, khopMaKien, soAutoNumberLark } from './client';

describe('buildOrderNumberSearchBody', () => {
  it('khớp cả dạng có # và không # (conjunction or)', () => {
    const body = buildOrderNumberSearchBody('#MBLVD28907') as {
      filter: { conjunction: string; conditions: Array<{ field_name: string; operator: string; value: string[] }> };
      page_size: number;
    };
    expect(body.filter.conjunction).toBe('or');
    const vals = body.filter.conditions.flatMap((c) => c.value);
    expect(vals).toContain('MBLVD28907');
    expect(vals).toContain('#MBLVD28907');
    expect(body.filter.conditions.every((c) => c.field_name === 'Order Number')).toBe(true);
    // Thêm nhánh 'contains' để bắt kiện GỘP nhiều đơn dính liền trong một ô.
    expect(body.filter.conditions.some((c) => c.operator === 'contains' && c.value.includes('#MBLVD28907'))).toBe(true);
    expect(body.page_size).toBe(500);
  });

  it('đầu vào không # vẫn sinh cả 2 dạng', () => {
    const body = buildOrderNumberSearchBody('TA2209') as {
      filter: { conditions: Array<{ value: string[] }> };
    };
    const vals = body.filter.conditions.flatMap((c) => c.value);
    expect(vals).toContain('TA2209');
    expect(vals).toContain('#TA2209');
  });

  it('bật automatic_fields để lấy created_time', () => {
    const body = buildOrderNumberSearchBody('#MBLVD1');
    expect(body.automatic_fields).toBe(true);
  });

  it('khớp cả dạng có # và không #', () => {
    const body = buildOrderNumberSearchBody('#MBLVD1') as { filter: { conditions: Array<{ value: string[] }> } };
    const vals = body.filter.conditions.flatMap((c) => c.value);
    expect(vals).toEqual(expect.arrayContaining(['MBLVD1', '#MBLVD1']));
  });
});

describe('soAutoNumberLark', () => {
  it('bóc phần số của mã kiện — Lark lọc AutoNumber theo SỐ, không theo chuỗi hiển thị', () => {
    expect(soAutoNumberLark('PK-19651')).toBe('19651');
  });

  it('không phân biệt hoa thường và khoảng trắng hai đầu', () => {
    expect(soAutoNumberLark('  pk-19651 ')).toBe('19651');
  });

  it('nhận cả số trần (Lark gửi thẳng số)', () => {
    expect(soAutoNumberLark('19651')).toBe('19651');
  });

  it('bỏ số 0 đệm đầu — giá trị thật của AutoNumber là một SỐ', () => {
    expect(soAutoNumberLark('PK-00019')).toBe('19');
  });

  it('chỉ lấy dãy số CUỐI, không gộp số trong tiền tố', () => {
    expect(soAutoNumberLark('PK2-19651')).toBe('19651');
  });

  it('không có số → null (không gọi Lark cho chắc)', () => {
    expect(soAutoNumberLark('PK-')).toBeNull();
    expect(soAutoNumberLark('')).toBeNull();
    expect(soAutoNumberLark('   ')).toBeNull();
  });
});

describe('khopMaKien', () => {
  it('khớp đúng tên hiển thị', () => {
    expect(khopMaKien('PK-19651', 'PK-19651')).toBe(true);
  });

  it('không phân biệt hoa thường và khoảng trắng', () => {
    expect(khopMaKien('PK-19651', '  pk-19651 ')).toBe(true);
  });

  it('LOẠI dòng cùng số nhưng khác tiền tố — lọc theo số nên tiền tố không vào điều kiện', () => {
    expect(khopMaKien('QC-19651', 'PK-19651')).toBe(false);
  });

  it('người gọi đưa số trần thì so theo số', () => {
    expect(khopMaKien('PK-19651', '19651')).toBe(true);
  });

  it('ô rỗng / kiểu lạ → không khớp', () => {
    expect(khopMaKien(null, 'PK-19651')).toBe(false);
    expect(khopMaKien({ text: 'PK-19651' }, 'PK-19651')).toBe(true);
    expect(khopMaKien(19651, 'PK-19651')).toBe(true);
  });
});
