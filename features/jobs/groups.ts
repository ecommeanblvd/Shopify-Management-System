import { JOB_KEYS } from './registry';

/**
 * Gộp tác vụ theo CHU KỲ để chạy chung một service cron.
 *
 * Vì sao gộp: mỗi service Railway nối với repo sẽ BUILD LẠI mỗi lần push code,
 * nên 17 service = 17 lượt build mỗi lần đẩy. Bản thân tiền chạy cron không
 * đáng kể (chạy xong là thoát; hoá đơn 05/09 $6,89/tháng, chủ yếu do web 24/7).
 *
 * NHƯNG chỉ gộp tác vụ NGẮN. Đo thật từ job_runs (05/09): sync-lark mất 68 PHÚT
 * mỗi lượt mà lịch là mỗi giờ — gộp nó với ai là cả nhóm chồng lấn. Tác vụ dài
 * phải đứng riêng để lịch của nó không kéo theo tác vụ khác.
 *
 * Mỗi tác vụ VẪN ghi một dòng job_runs riêng, nên trang giám sát không đổi.
 */
export const NHOM_JOB: Record<string, readonly string[]> = {
  // ── KHÔNG gộp: tác vụ chạy LÂU, gộp vào là cả nhóm chồng lấn nhau.
  //    Đo thật 05/09 từ job_runs: sync-lark 68 PHÚT/lượt (lịch mỗi giờ → luôn
  //    chồng), sync-orders 6,8 phút. Đây mới là chỗ tốn tiền, không phải số
  //    lượng service.
  'sync-lark': ['sync-lark'],
  'sync-orders': ['sync-orders'],

  // ── Gộp được: các tác vụ chạy trong vài giây tới vài chục giây.
  'moi-15-phut': ['retry-mmp-orders', 'retry-ship-ho-events'],
  'moi-6-gio': ['sync-lifecycle', 'track-shipments', 'track-ship-ho'],
  // Việc bám theo nhịp đồng bộ đơn — tách khỏi 'sync-orders' ngày 05/09 để
  // mỗi việc có nhật ký riêng; trước đó 11 việc dùng chung một tên tác vụ nên
  // nhìn "5,9 phút" không biết việc nào chậm.
  'theo-don': ['push-unsent-brand', 'addr-verify', 'apply-pod', 'return-links', 'ship-ho-reconcile'],
  'hang-ngay': [
    'ship-ho-tiers', 'refresh-fuel', 'refresh-surcharges', 'refresh-vcb-fx',
    'sync-warehouse', 'sync-meanblvd', 'create-sale', 'sync-catalog',
  ],
  'hang-tuan': ['prune-logs', 'refresh-demand', 'remind-fuel'],
  'hang-thang': ['sync-geo'],
};

export const TEN_NHOM = Object.keys(NHOM_JOB);

/** THUẦN: tác vụ nào chưa được xếp nhóm (sẽ không bao giờ chạy). */
export function jobChuaXepNhom(): string[] {
  const daXep = new Set(Object.values(NHOM_JOB).flat());
  return JOB_KEYS.filter((k) => !daXep.has(k));
}

/** THUẦN: tác vụ bị xếp vào NHIỀU nhóm (sẽ chạy trùng). */
export function jobTrungNhom(): string[] {
  const dem = new Map<string, number>();
  for (const ks of Object.values(NHOM_JOB)) for (const k of ks) dem.set(k, (dem.get(k) ?? 0) + 1);
  return [...dem.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}
