import { maHienThi } from '@/features/ship-ho/ma-hien-thi';

/**
 * Mã đơn ship hộ: mã LOG (chuẩn vận hành) đứng trước, mã hệ thống xuống dòng phụ.
 *
 * Phần ĐUÔI được nhấn vì hai mã cùng khuôn `YY-INSLG-SV-NNNN` và chỉ khác bốn số cuối —
 * nhấn đuôi là cách chống đọc nhầm, không dựa vào màu (màu không được là dấu hiệu duy nhất).
 * Không có màu riêng cho nhãn: thứ bậc do VỊ TRÍ và ĐỘ ĐẬM mang, nên không giẫm lên các màu
 * đã có nghĩa trong bảng (đỏ = lệch, hổ phách = cân đội, chàm = MMP).
 */
export function MaDon({ code, larkOrderNumber, hienMaPhu = true }: {
  code: string;
  larkOrderNumber?: string | null;
  /** false khi màn hình đã hiện mã hệ thống ở chỗ khác (vd tiêu đề trang chi tiết). */
  hienMaPhu?: boolean;
}) {
  const { chinh, phu, thieuMaLog, cungDau } = maHienThi({ code, larkOrderNumber });
  return (
    <>
      <span
        className="whitespace-nowrap font-mono tabular-nums"
        title={chinh.nhan === 'LOG' ? `Mã bảng LOG (Lark): ${chinh.ma}` : `Mã hệ thống: ${chinh.ma}`}
      >
        <span className="text-muted-foreground">{chinh.dau}</span>
        <span className="font-semibold">{chinh.duoi}</span>
      </span>
      {hienMaPhu && phu && (
        <span
          className="ml-1 whitespace-nowrap text-[10px] font-normal text-muted-foreground"
          title={`Mã hệ thống (khoá kỹ thuật): ${phu.ma}`}
        >
          HT <span className="font-mono tabular-nums">{cungDau ? phu.duoi : phu.ma}</span>
        </span>
      )}
      {hienMaPhu && thieuMaLog && (
        <span className="ml-1 whitespace-nowrap text-[10px] font-normal text-muted-foreground" title="Đội logistics chưa tạo dòng trên bảng LOG (thường vì chưa đóng hàng)">
          chưa có mã LOG
        </span>
      )}
    </>
  );
}
