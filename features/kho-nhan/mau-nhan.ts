/**
 * THUẦN: màu nhãn cột "Kho" và "Loại nhập" của Sổ nhập — mỗi giá trị một màu để
 * mắt phân biệt được khi quét bảng (CEO 28/09/2026).
 *
 * Ba luật khi chọn màu ở đây, vì bảng dày 38px/dòng và 14 cột:
 *
 * 1. MÀU LÀ KÊNH THỨ HAI, không phải kênh duy nhất — chữ luôn hiện đủ. Người mù
 *    màu vẫn đọc được y như trước (quy tắc a11y "đừng nói bằng màu").
 * 2. GIÁ TRỊ ÁP ĐẢO PHẢI LẶNG. `Retail` là 6.165/8.976 dòng (76%); tô nó rực thì
 *    3/4 bảng nhoè màu mà không nói thêm gì. Nó nhận màu trung tính, để màu nổi
 *    dành cho thứ hiếm — đúng chiều thông tin.
 * 3. CÙNG HỌ THÌ MÀU CẠNH NHAU trên vành màu (Tồn kho → amber/orange/yellow…,
 *    Mượn Vendor → fuchsia/purple, VTĐG → sky/indigo). Khác nhau đủ để phân biệt,
 *    gần nhau đủ để đọc ra "hai cái này cùng loại" trước khi đọc chữ.
 *
 * Hai màu ĐÃ MANG NGHĨA trong bảng này nên không ai khác được dùng:
 *   • đỏ  = QC hỏng (tint cả dòng) → chỉ `Đồ lỗi (k bán)` được mượn, vì cùng nghĩa;
 *   • emerald = nhãn nguồn "Hệ thống".
 */

/** Nền + chữ, sáng và tối. Giá trị lạ/rỗng dùng cái này — KHÔNG mượn màu có nghĩa. */
const TRUNG_TINH = 'bg-muted text-muted-foreground';

/* MỌI class dưới đây phải là CHUỖI LITERAL, không ghép bằng `${}`.
 * Tailwind 4 không có file config: nó quét SOURCE để biết phải sinh CSS nào, nên
 * class ghép lúc chạy không tồn tại trong CSS và nhãn mất màu sạch sẽ — test đơn
 * vị vẫn xanh vì chuỗi trả về vẫn "đúng". Test `mau-nhan.test.ts` canh luật này. */

/** Ba kho thật trên Lark (đo 28/09/2026). */
export const KHO_THAT = ['HN | GVM', 'SG | AP', 'SG | DM'] as const;

/** Hai kho SG lấy hai sắc xanh cạnh nhau, HN lấy tím — đọc ra thành phố trước khi đọc mã. */
const MAU_KHO: Record<string, string> = {
  'HN | GVM': 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'SG | AP': 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300',
  'SG | DM': 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
};

/** Mười bốn loại nhập thật trên Lark (đo 28/09/2026), xếp theo số dòng giảm dần. */
export const LOAI_NHAP_THAT = [
  'Retail', 'Tồn kho (Consignment)', 'Tồn kho (Return)', 'Tồn kho (PO)',
  'Retail (order before 8.24)', 'Mượn Vendor/ Sample - k theo order',
  'Mượn Vendor - KOL', 'CompGift', 'VTĐG2', 'Tồn kho (Cancel/ Sai địa chỉ)',
  'Tồn kho TQ', 'VTĐG1', 'Tồn kho (MEAN Design)', 'Đồ lỗi (k bán)',
] as const;

const MAU_LOAI_NHAP: Record<string, string> = {
  // Retail — 76% số dòng, phải lặng nhất bảng. Bản cũ ("order before 8.24") xám
  // sâu hơn một bậc: cùng họ, và vốn là rổ dữ liệu cũ.
  'Retail': 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  'Retail (order before 8.24)': 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',

  // Tồn kho — họ ấm. Bậc chữ ở chế độ sáng chọn theo TƯƠNG PHẢN ĐO ĐƯỢC trên nền
  // đã chồng 15%, không chọn cho đều: amber/yellow/orange/green/teal phải lên 800
  // mới đạt 4,5:1 (đo 28/09/2026 trên CSS đã build).
  'Tồn kho (Consignment)': 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  'Tồn kho (PO)': 'bg-orange-500/15 text-orange-800 dark:text-orange-300',
  'Tồn kho (Return)': 'bg-yellow-500/15 text-yellow-800 dark:text-yellow-300',
  'Tồn kho TQ': 'bg-green-500/15 text-green-800 dark:text-green-300',
  'Tồn kho (MEAN Design)': 'bg-teal-500/15 text-teal-800 dark:text-teal-300',
  // Cancel/Sai địa chỉ lấy rose vì nó LÀ một dạng sự cố.
  'Tồn kho (Cancel/ Sai địa chỉ)': 'bg-rose-500/15 text-rose-700 dark:text-rose-300',

  // Mượn Vendor — hai sắc hồng tím cạnh nhau.
  'Mượn Vendor/ Sample - k theo order': 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300',
  'Mượn Vendor - KOL': 'bg-purple-500/15 text-purple-700 dark:text-purple-300',

  // VTĐG — hai sắc lam cạnh nhau.
  'VTĐG1': 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'VTĐG2': 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',

  'CompGift': 'bg-pink-500/15 text-pink-700 dark:text-pink-300',
  // Đỏ: cùng nghĩa với tint dòng QC hỏng, nên đây là chỗ DUY NHẤT được dùng.
  'Đồ lỗi (k bán)': 'bg-red-500/15 text-red-700 dark:text-red-300',
};

const tra = (bang: Record<string, string>, v: string | null | undefined) =>
  bang[(v ?? '').trim()] ?? TRUNG_TINH;

export function mauKho(v: string | null | undefined): string {
  return tra(MAU_KHO, v);
}

export function mauLoaiNhap(v: string | null | undefined): string {
  return tra(MAU_LOAI_NHAP, v);
}
