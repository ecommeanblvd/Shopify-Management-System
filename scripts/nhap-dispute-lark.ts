/** Nhập tranh chấp PayPal/Stripe từ bảng Lark Dispute Management. CHỈ ĐỌC Lark. */
import { nhapDisputeTuLark } from '../features/dispute/nhap-lark';

async function main(): Promise<void> {
  const t0 = Date.now();
  const k = await nhapDisputeTuLark((s) => process.stdout.write(`${s}\n`));
  process.stdout.write(
    `\nXONG: đọc ${k.doc} · thêm ${k.them} · đã có ${k.boQuaDaCo}`
    + ` · bỏ qua vì là Shopify Payment ${k.boQuaShopify}`
    + ` · ghi chú đính vào ca đã sync ${k.ghiChuDinhVaoCaSync}`
    + ` · thiếu dữ liệu ${k.thieuDuLieu} · nối được đơn ${k.noiDuocDon}`
    + ` (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`,
  );
  process.exit(0);
}
void main();
