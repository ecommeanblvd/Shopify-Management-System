import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/fedex/track', () => ({ trackFedex: vi.fn() }));
vi.mock('@/lib/dhl/track', () => ({ trackDhl: vi.fn() }));
vi.mock('@/lib/trackingmore/track', () => ({
  hasTrackingMoreKey: vi.fn(() => true),
  trackViaTrackingMore: vi.fn(),
}));

import { trackAny } from './track-any';
import { trackFedex } from '@/lib/fedex/track';
import { trackViaTrackingMore, hasTrackingMoreKey } from '@/lib/trackingmore/track';

const ok = { statusCode: 'delivered', status: 'delivered' as const, description: 'Delivered', deliveredAt: new Date('2026-09-01') };

describe('trackAny', () => {
  beforeEach(() => vi.clearAllMocks());

  it('hãng trả được → dùng luôn, không đụng tới dự phòng', async () => {
    vi.mocked(trackFedex).mockResolvedValue(ok);
    const r = await trackAny('fedex', '123');
    expect(r.source).toBe('carrier');
    expect(trackViaTrackingMore).not.toHaveBeenCalled();
  });

  it('hãng hỏng → rơi sang dự phòng', async () => {
    vi.mocked(trackFedex).mockRejectedValue(new Error('FedEx 403 FORBIDDEN'));
    vi.mocked(trackViaTrackingMore).mockResolvedValue(ok);
    const r = await trackAny('fedex', '123');
    expect(r.source).toBe('trackingmore');
  });

  it('CẢ HAI hỏng → lỗi phải nêu đủ hai lý do, không nuốt lỗi dự phòng', async () => {
    vi.mocked(trackFedex).mockRejectedValue(new Error('FedEx 403 FORBIDDEN.ERROR'));
    vi.mocked(trackViaTrackingMore).mockRejectedValue(new Error('trackingmore 4190: maximum quota'));
    // Kiểm CẢ HAI vế xuất hiện — không dùng cờ /s (cần target es2018).
    const loi = await trackAny('fedex', '123').catch((e: Error) => e.message);
    expect(loi).toContain('403 FORBIDDEN.ERROR');
    expect(loi).toContain('maximum quota');
  });

  it('không có key dự phòng → ném thẳng lỗi hãng', async () => {
    vi.mocked(hasTrackingMoreKey).mockReturnValue(false);
    vi.mocked(trackFedex).mockRejectedValue(new Error('FedEx 403'));
    await expect(trackAny('fedex', '123')).rejects.toThrow('FedEx 403');
  });
});
