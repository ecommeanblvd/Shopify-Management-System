import { describe, it, expect, vi, beforeEach } from 'vitest';

const ketThucJob = vi.fn();
const batDauJob = vi.fn(async () => 'run-1');

vi.mock('./record', () => ({
  batDauJob: (...a: unknown[]) => batDauJob(...(a as [])),
  ketThucJob: (...a: unknown[]) => ketThucJob(...(a as [string, object])),
}));

const { chayJobApi } = await import('./api-run');

/**
 * Vì sao có bộ kiểm này: tác vụ `refresh-fuel` chạy qua route HTTP đã báo `ok`
 * 40/40 lượt trong khi UPS và SF Express đứng im 11 tuần. "Chạy xong" KHÔNG
 * đồng nghĩa "làm được việc" — `kiemTra` là chỗ tác vụ tự khai phần hỏng, và
 * câu khai đó phải đi thẳng vào `job_runs.error` kèm TÊN thứ hỏng.
 */
describe('chayJobApi', () => {
  beforeEach(() => { ketThucJob.mockClear(); batDauJob.mockClear(); });

  it('không có kiemTra → ghi ok như cũ', async () => {
    await chayJobApi('refresh-fuel', async () => ({ tong: 4 }));
    expect(ketThucJob).toHaveBeenCalledWith('run-1', expect.objectContaining({ ok: true }));
  });

  it('kiemTra trả null → ghi ok', async () => {
    await chayJobApi('refresh-fuel', async () => ({ tong: 4 }), () => null);
    expect(ketThucJob).toHaveBeenCalledWith('run-1', expect.objectContaining({ ok: true }));
  });

  it('kiemTra trả lý do → lượt chạy ĐỎ, giữ summary, error gọi tên hãng', async () => {
    const kq = { tong: 4, hong: ['[ups] UPS Worldwide Expedited: 404'] };
    const ret = await chayJobApi(
      'refresh-fuel',
      async () => kq,
      (s) => `1/${s.tong} hãng lỗi — ${s.hong.join(' | ')}`,
    );
    expect(ret).toBe(kq); // vẫn trả kết quả cho người gọi
    expect(ketThucJob).toHaveBeenCalledWith('run-1', expect.objectContaining({
      ok: false,
      summary: kq,
      error: expect.stringContaining('UPS Worldwide Expedited'),
    }));
  });

  it('fn ném lỗi → vẫn ghi đỏ và ném tiếp', async () => {
    await expect(
      chayJobApi('refresh-fuel', async () => { throw new Error('sập'); }),
    ).rejects.toThrow('sập');
    expect(ketThucJob).toHaveBeenCalledWith('run-1', expect.objectContaining({ ok: false }));
  });
});
