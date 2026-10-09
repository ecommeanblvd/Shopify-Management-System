import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { moTaTinHieu } from './run';

const NGUON = readFileSync(new URL('./run.ts', import.meta.url), 'utf8');

describe('moTaTinHieu', () => {
  /* Câu chữ phải nói đúng điều SUY RA ĐƯỢC: nhận tín hiệu = có người/nền tảng chủ động dừng.
     Không được viết thành "hết bộ nhớ" — hết bộ nhớ là SIGKILL, không bắt được, nên nếu đọc
     thấy dòng này thì chắc chắn KHÔNG phải hết bộ nhớ. */
  it('nói rõ là bị dừng TỪ NGOÀI, không đoán nguyên nhân hết bộ nhớ', () => {
    const m = moTaTinHieu('SIGTERM');
    expect(m).toContain('SIGTERM');
    expect(m).toContain('dừng từ ngoài');
    expect(m).not.toMatch(/hết bộ nhớ|OOM/i);
  });
});

/**
 * CHẶN MÁY cho phần đo thêm ngày 09/10/2026.
 *
 * Đo 14 ngày: `sync-lark` kẹt `running` 15/337 lượt, `sync-orders` 6/323 — tiến trình chết mà
 * không nhánh try/catch nào chạy. Mọi lượt chết đều trong 4,5 phút đầu, sớm nhất 1 giây, tức
 * KHÔNG chạm hạn 15 hay 90 phút. Hai thứ dưới đây là thiết bị đo phân biệt hai khả năng còn
 * lại; gỡ chúng là quay về chỗ mù.
 */
describe('chayCron: thiết bị đo lượt bị dừng', () => {
  it('bắt CẢ SIGTERM lẫn SIGINT', () => {
    expect(NGUON).toMatch(/'SIGTERM',\s*'SIGINT'/);
  });

  /* Phải gắn NGAY SAU `batDauJob` — gắn muộn hơn là có một khoảng tiến trình chạy mà tín hiệu
     tới thì không ai ghi lại, và khoảng đó chính là nơi 4 lượt chết sau 1 giây rơi vào. */
  it('gắn ngay sau batDauJob, trước khi chạy việc', () => {
    const than = NGUON.slice(NGUON.indexOf('export function chayCron'));
    const iBatDau = than.indexOf('batDauJob(jobKey)');
    const iGan = than.indexOf('batTinHieuDung(');
    const iChay = than.indexOf('await fn()');
    expect(iBatDau).toBeGreaterThan(-1);
    expect(iGan).toBeGreaterThan(iBatDau);
    expect(iChay).toBeGreaterThan(iGan);
  });

  /* Bộ nhớ in kèm mỗi việc: khi KHÔNG có tín hiệu nào (tức SIGKILL/hết bộ nhớ) thì dòng cuối
     trước lúc chết là bằng chứng duy nhất đọc được. */
  it('in bộ nhớ đang dùng ở mỗi việc con', () => {
    expect(NGUON).toMatch(/memoryUsage\(\)\.rss/);
  });
});
