/**
 * Nạp mốc hãng lấy hàng (`picked_up_at`) từ lịch sử quét của hãng.
 *
 * Chỉ là vỏ gọi `napNgayLayHang` — luật nằm ở đó, và cron cũng gọi đúng hàm ấy. Bản đầu của
 * script này có câu truy vấn RIÊNG; khi module mở rộng sang UPS thì script vẫn lọc mỗi FedEx và
 * im lặng bỏ qua 5 đơn UPS. Hai bản sao của một câu hỏi là hẹn ngày chúng lệch nhau.
 *
 * Chạy: railway run --service Shopify-Management-System npx tsx scripts/nap-ngay-lay-hang.ts [--ap-dung]
 */
import { napNgayLayHang } from '@/features/ship-ho/nap-ngay-lay-hang';

async function main(): Promise<void> {
  if (!process.argv.includes('--ap-dung')) {
    console.log('CHỈ ĐẾM chưa làm được cho lượt nạp này — nó phải gọi hãng mới biết có dữ liệu hay không.');
    console.log('Chạy thẳng với --ap-dung: lượt nạp chỉ ghi vào đơn đang TRỐNG `picked_up_at`, không ghi đè gì.');
    process.exit(0);
  }
  const k = await napNgayLayHang({ gioiHan: 500 });
  console.log(`thử ${k.thu} đơn · lấy được ${k.co} · chưa có dữ liệu ${k.khong} · lệch ngày gửi ${k.lech}`);
  process.exit(0);
}
main();
