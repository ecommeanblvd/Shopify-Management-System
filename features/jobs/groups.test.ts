import { readdirSync, readFileSync } from 'node:fs';
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

describe('MỌI tác vụ phải có chỗ thật sự chạy (CEO 29/09/2026)', () => {
  /* Bài học đắt: đo job_runs ngày 29/09 thì NĂM tác vụ chưa chạy lần nào kể từ
     khi được khai — `dong-bo-wh-lark`, `sync-dispute`, `day-production-time-cx`,
     `gom-bang-ke-nhap`, `dien-store-final`. Tất cả đều nằm trong nhóm
     'moi-6-gio', mà KHÔNG service Railway nào gọi `run-group`: cron ở đây là MỖI
     VIỆC MỘT SERVICE. Khai vào nhóm là khai suông.

     Nên bất biến cần giữ KHÔNG phải "có nhóm" mà là "có nơi gọi". Test này quét
     toàn bộ scripts/cron/ + bảng CHAY của run-group, và bắt ngay tác vụ nào
     không có chỗ chạy — thay vì để nó chết âm thầm hàng tuần. */
  /* Quét CẢ repo chứ không chỉ scripts/cron: `noi-line-id-mon` chạy lồng trong
     `syncBrandReceived` (features/), còn `lark-pack-webhook` là endpoint HTTP
     (app/api/lark/pack). Chúng chạy thật — 142 và 310 lượt — nên nơi gọi phải
     tính cả hai chỗ đó, nếu không test này báo oan. */
  const GOC = new URL('../../', import.meta.url);
  const THU_MUC_QUET = ['scripts/', 'features/', 'app/'];

  const quet = (duong: URL, ra: Set<string>): void => {
    for (const e of readdirSync(duong, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const con = new URL(`${e.name}${e.isDirectory() ? '/' : ''}`, duong);
      if (e.isDirectory()) { quet(con, ra); continue; }
      if (!e.name.endsWith('.ts') && !e.name.endsWith('.tsx')) continue;
      if (e.name.includes('.test.')) continue;
      const src = readFileSync(con, 'utf8');
      for (const re of [/chayMotJob\(\s*'([a-z0-9-]+)'/g, /chayCron\(\s*'([a-z0-9-]+)'/g, /\{\s*key:\s*'([a-z0-9-]+)'/g, /^\s*'([a-z0-9-]+)':\s*\(\)\s*=>/gm]) {
        for (const m of src.matchAll(re)) ra.add(m[1]!);
      }
    }
  };

  const noiGoi = (): Set<string> => {
    const ra = new Set<string>();
    for (const t of THU_MUC_QUET) quet(new URL(t, GOC), ra);
    return ra;
  };

  it('không tác vụ nào bị bỏ rơi — trừ nhóm chua-bat cố ý tắt', () => {
    const goi = noiGoi();
    const coYTat = new Set(NHOM_JOB['chua-bat'] ?? []);
    const boRoi = JOB_KEYS.filter((k) => !goi.has(k) && !coYTat.has(k));
    expect(boRoi, `tác vụ không có chỗ gọi: ${boRoi.join(', ')}`).toEqual([]);
  });

  it('năm tác vụ từng chết âm thầm nay đều có chỗ gọi', () => {
    const goi = noiGoi();
    for (const k of ['dong-bo-wh-lark', 'sync-dispute', 'day-production-time-cx', 'gom-bang-ke-nhap', 'dien-store-final']) {
      expect(goi.has(k), `${k} không có chỗ gọi`).toBe(true);
    }
  });
});
