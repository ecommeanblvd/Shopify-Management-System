import { describe, it, expect } from 'vitest';
import { NHOM_JOB, jobChuaXepNhom, jobTrungNhom } from './groups';
import { JOB_KEYS } from './registry';

describe('nhóm tác vụ', () => {
  it('MỌI tác vụ trong sổ đăng ký đều thuộc một nhóm — sót là không bao giờ chạy', () => {
    expect(jobChuaXepNhom()).toEqual([]);
  });

  it('không tác vụ nào thuộc hai nhóm — trùng là chạy hai lần', () => {
    expect(jobTrungNhom()).toEqual([]);
  });

  it('không khai khoá lạ ngoài sổ đăng ký', () => {
    for (const [nhom, ks] of Object.entries(NHOM_JOB))
      for (const k of ks) expect(JOB_KEYS, `nhóm ${nhom} có khoá lạ "${k}"`).toContain(k);
  });

  it('hàng đợi gửi đối tác nằm ở nhóm chạy dày nhất', () => {
    expect(NHOM_JOB['moi-15-phut']).toContain('retry-mmp-orders');
    expect(NHOM_JOB['moi-15-phut']).toContain('retry-ship-ho-events');
  });
});
