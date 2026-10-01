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
  // push-nhan-hang chạy LỒNG trong script sync-lark.ts (qua chayMotJob), không
  // qua run-group — khai chung nhóm để không "chưa xếp nhóm" (test canh việc
  // này), dù thực thi là cùng một tiến trình với sync-lark.
  // sync-lark-ship-ho cũng chạy LỒNG trong script sync-lark.ts như push-nhan-hang.
  // ghi-nguoc-lark cũng chạy LỒNG trong sync-lark.ts, dùng lại record đã tải.
  // noi-line-id-mon chạy LỒNG trong syncBrandReceived (gọi từ cả sync-lark.ts lẫn route HTTP).
  // ĐO 29/09/2026: KHÔNG có service Railway nào gọi `run-group`. Các service cron
  // là MỖI VIỆC MỘT SERVICE (cron-track-shipments, cron-sync-lifecycle, …), nên
  // khai một việc vào nhóm mà không service nào chạy = việc KHÔNG BAO GIỜ chạy.
  // Năm việc từng mắc đúng lỗi này (dong-bo-wh-lark, sync-dispute,
  // day-production-time-cx, gom-bang-ke-nhap, dien-store-final) — nay chuyển sang
  // chạy LỒNG trong hai script có service thật.
  'sync-lark': ['sync-lark', 'push-nhan-hang', 'sync-lark-ship-ho', 'ghi-nguoc-lark', 'noi-line-id-mon',
    'dong-bo-wh-lark', 'dong-bo-can-lark', 'dien-store-final', 'day-production-time-cx',
    'dong-bo-po-lark'],
  'sync-orders': ['sync-orders', 'gom-bang-ke-nhap', 'sync-dispute'],

  // ── Gộp được: các tác vụ chạy trong vài giây tới vài chục giây.
  'moi-15-phut': ['retry-mmp-orders', 'retry-ship-ho-events'],
  // CHƯA NỐI SERVICE — cố ý. CEO 23/09/2026: dựng xong màn Nhận hàng & KCS rồi mới kiểm từng
  // bản ghi lên Lark một, nên việc đẩy tự động phải nằm ngoài mọi nhóm đang chạy. Khi nào bật
  // thì chuyển khoá này vào 'moi-15-phut'.
  'chua-bat': ['day-nhan-kcs-lark'],
  // `dong-bo-wh-lark` mất ~2 phút (9.122 dòng, 19 lượt gọi Lark) nên KHÔNG
  // để ở 'moi-15-phut' cùng các việc vài giây. CHỈ ĐỌC từ Lark — không dính
  // tới lệnh hoãn ghi tự động của CEO.
  // `sync-dispute` CHỈ ĐỌC từ Shopify. 6 giờ là quá đủ: hạn nộp bằng chứng của
  // Shopify cách ngày mở 16–40 ngày.
  // `day-production-time-cx` đo thật 28/09: 26 giây, đọc 5.968 dòng bảng CX. Cùng
  // tính chất với `dong-bo-wh-lark` nên ở cùng nhóm, KHÔNG để ở 'moi-15-phut'
  // cùng các việc vài giây. Ghi ĐÚNG HAI cột và bỏ qua dòng đã đúng, nên chạy
  // lại nhiều lần vô hại.
  // `gom-bang-ke-nhap` CHỈ tạo/bổ sung bản NHÁP, không bao giờ tự phát hành — chốt
  // kỳ là việc kế toán, người bấm (CEO 28/09/2026). Chạy lại vô hại: kỳ đã có nháp
  // thì gom thêm vào đúng bản đó rồi tính lại tổng.
  'moi-6-gio': ['sync-lifecycle', 'track-shipments', 'track-ship-ho'],
  // Việc bám theo nhịp đồng bộ đơn — tách khỏi 'sync-orders' ngày 05/09 để
  // mỗi việc có nhật ký riêng; trước đó 11 việc dùng chung một tên tác vụ nên
  // nhìn "5,9 phút" không biết việc nào chậm.
  'theo-don': ['push-unsent-brand', 'refresh-owned-store', 'addr-verify', 'apply-pod', 'return-links', 'ship-ho-bao-gia', 'ship-ho-gia-thu', 'ship-ho-reconcile', 'doi-chieu-ly-do'],
  'hang-ngay': ['ship-ho-tiers', 'refresh-fuel', 'refresh-surcharges', 'sync-unit-cost', 'apply-own-cogs'],
  'hang-tuan': ['prune-logs'],

  // Không phải cron: Lark Automation gọi /api/lark/pack, mỗi request một dòng job_runs.
  // Khai nhóm để test "mọi tác vụ đều có nhóm" không kêu; run-group sẽ báo "chưa nối" nếu ai chạy nhầm.
  'tu-lark': ['lark-pack-webhook'],
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
