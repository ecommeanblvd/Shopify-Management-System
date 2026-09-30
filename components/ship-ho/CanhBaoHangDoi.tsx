import { hangDoiHongShipHo } from '@/features/ship-ho/hang-doi-hong-queries';

/** Số ngày kẹt — "kẹt bao lâu rồi" mới là thứ thúc người ta xử lý, không phải con số tổng. */
function soNgay(tu: Date): number {
  return Math.max(0, Math.floor((Date.now() - tu.getTime()) / 86_400_000));
}

/**
 * Cảnh báo sự kiện gửi MMP còn kẹt, đặt ngay trên màn đơn ship hộ.
 *
 * Vì sao ở ĐÂY chứ không phải một trang riêng (30/09/2026): outbox tích 84 sự kiện hỏng suốt
 * nhiều tuần, trong đó 2 đơn đã giao trị giá 3.127.489đ không vào được công nợ — vì không có
 * chỗ nào hiện nó ra. Cảnh báo đặt ở trang không ai mở thì bằng không có cảnh báo.
 *
 * Hàng đợi sạch thì KHÔNG hiện gì: một dải báo "mọi thứ ổn" nằm thường trực sẽ dạy người đọc
 * bỏ qua đúng chỗ đó, rồi lần nó đỏ thật cũng không ai nhìn.
 */
export async function CanhBaoHangDoi() {
  const h = await hangDoiHongShipHo();
  if (h.tong === 0) return null;
  const ngay = h.cuNhat ? soNgay(h.cuNhat) : 0;
  return (
    <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
      <div className="font-medium text-red-800 dark:text-red-300">
        {h.tong} sự kiện chưa gửi được sang MMP
        {ngay > 0 && <> · cũ nhất kẹt <span className="tabular-nums">{ngay}</span> ngày</>}
      </div>
      <p className="mt-1 text-red-700/90 dark:text-red-400/90">
        Đơn có sự kiện kẹt thì MMP không nhận được thông tin đó — giá chốt không vào công nợ,
        và đơn không vào được bảng kê nào.
      </p>
      <ul className="mt-2 space-y-1">
        {h.nhom.map((n) => (
          <li key={n.lyDo} className="text-red-800 dark:text-red-300">
            <span className="tabular-nums font-medium">{n.so}</span>
            {' · '}
            <span className="font-mono text-xs">{n.lyDo}</span>
            <span className="text-red-700/70 dark:text-red-400/70">
              {' — '}{n.don.slice(0, 6).join(', ')}{n.don.length > 6 && ` +${n.don.length - 6} đơn nữa`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
