/**
 * THUẦN: ai xem được báo lỗi nào. Không I/O, không đụng CSDL.
 *
 * ## Luật (CEO 29–30/10/2026)
 *
 * *"bộ phận nào xem được lỗi của bộ phận đó, còn admin và Operation Coordinator thì xem được hết"*
 * — thi hành bằng **quyền**, không bằng cột bộ phận: **"đọc được lỗi của màn mình mở được"**.
 *
 * Vì sao không chặn theo `app_roles.bo_phan`: đo thật 29/10/2026, trong 5 vai trò **chỉ
 * `logistics` có bộ phận** (`DISCO-LOG`); `admin`, `OC`, `operator`, `viewer` đều để trống. Mà
 * `operator` có 5 người và là rổ chung nhiều việc nên gán nó vào một bộ phận là sai. Luật theo
 * quyền **tự đúng** khi thêm người hoặc đổi quyền — không ai phải bảo trì bảng ánh xạ.
 *
 * ## Hai cái bẫy đã đo, đừng gỡ
 *
 * 1. **Nguồn quyền là `NAV` VÀ `SETTINGS_ITEMS`, không chỉ `NAV`.** Sáu module chỉ khai trong
 *    `SETTINGS_ITEMS` (`stores`, `settings-sync`, `markets`, `jobs`, `can-san-pham`, `admin`).
 *    Bỏ sót nó thì `can-san-pham` — màn cần `view_kpi_logistics`, tức ĐÚNG 2 người logistics —
 *    rơi vào nhóm chỉ-quản-lý, nghĩa là **giấu lỗi của màn chính họ dùng khỏi chính họ**.
 * 2. **`requires: null` thì KHÔNG dựng quyền.** `NAV` có `{ href: '/', requires: null }` và
 *    `{ href: '/settings', requires: null }`, mà `canSeeNavItem` trả `true` cho `null` — dựng
 *    quyền từ chúng là biến `khac` và `settings` thành "ai cũng thấy", phá đúng ý fail-closed.
 *
 * Module không rút được quyền nào ⇒ **chỉ người có `view_bao_loi_tat_ca`**. Sau khi vá hai bẫy
 * trên, nhóm đó còn đúng ba: `settings`, `nhat-ky`, `khac`.
 *
 * ## Ảnh siết hơn chữ (thiết kế §11, CEO chốt lối (b))
 *
 * Chữ đi theo luật phạm vi; **ảnh** chỉ người báo và `view_bao_loi_tat_ca`. Ảnh là chỗ lọt dữ
 * liệu ngoài ý muốn: màn Lãi gộp cần quyền riêng `orders.cogs:view` nhưng thuộc module `orders`,
 * nên một ảnh chụp màn đó sẽ lọt cho mọi người có `view_orders` nếu ảnh đi cùng luật chữ.
 */
import { NAV, SETTINGS_ITEMS } from '@/lib/nav';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { moduleTuDuongDan } from './phan-loai';

/* `NAV` và `SETTINGS_ITEMS` là hằng tĩnh nên bản đồ dựng MỘT lần cho cả tiến trình. Không phụ
 * thuộc vai nào, nên nhớ đệm ở đây không làm lẫn quyền giữa hai người đọc. */
let dem: ReadonlyMap<string, readonly Permission[]> | null = null;

/** Mã module → danh sách quyền MỞ ĐƯỢC màn đó, nghĩa OR. Mục `requires: null` bị bỏ qua. */
export function quyenCuaModule(): ReadonlyMap<string, readonly Permission[]> {
  if (dem) return dem;
  const ra = new Map<string, Permission[]>();
  for (const muc of [...NAV, ...SETTINGS_ITEMS]) {
    if (muc.requires === null) continue;
    const ma = moduleTuDuongDan(muc.href).ma;
    const them = Array.isArray(muc.requires) ? muc.requires : [muc.requires];
    const co = ra.get(ma) ?? [];
    for (const q of them) if (!co.includes(q)) co.push(q);
    ra.set(ma, co);
  }
  dem = ra;
  return ra;
}

/**
 * Phạm vi của một vai: `tatCa` ⇒ mọi module; ngược lại là tập mã module xem được.
 *
 * Thiếu `view_bao_loi` ⇒ tập RỖNG, **không ném**: hàm này chạy bên trong panel của mọi module,
 * một ngoại lệ ở đây làm sập cả màn người ta đang làm việc.
 */
export function moduleXemDuoc(roleKey: string): { tatCa: boolean; module: ReadonlySet<string> } {
  if (hasPermission(roleKey, 'view_bao_loi_tat_ca')) return { tatCa: true, module: new Set() };
  if (!hasPermission(roleKey, 'view_bao_loi')) return { tatCa: false, module: new Set() };
  const ra = new Set<string>();
  for (const [ma, quyen] of quyenCuaModule()) {
    if (quyen.some((q) => hasPermission(roleKey, q))) ra.add(ma);
  }
  return { tatCa: false, module: ra };
}

/**
 * Đọc được phần CHỮ của một báo lỗi hay không.
 *
 * `laNguoiBao` chặn ngắn TRƯỚC cả `view_bao_loi`, cố ý: giấu báo lỗi của một người khỏi chính
 * họ chỉ vì một khoá quyền chưa được seed là tái hiện đúng thất bại mà màn này sinh ra để sửa
 * (ghi chú 1.069 ký tự viết riêng cho Tú mà Tú không với tới được).
 */
export function xemDuocChu(a: { roleKey: string; module: string; laNguoiBao: boolean }): boolean {
  if (a.laNguoiBao) return true;
  const pv = moduleXemDuoc(a.roleKey);
  return pv.tatCa || pv.module.has(a.module);
}

/** Xem được ẢNH đính kèm hay không — siết hơn chữ, xem phần đầu tệp. */
export function xemDuocAnh(a: { roleKey: string; laNguoiBao: boolean }): boolean {
  return a.laNguoiBao || hasPermission(a.roleKey, 'view_bao_loi_tat_ca');
}

/**
 * Mô tả phạm vi đọc, dạng dữ liệu THUẦN để tầng truy vấn dựng điều kiện SQL từ nó.
 *
 * Vì sao là mô tả chứ không phải điều kiện Drizzle: quyết định thật nằm ở "lọc hay không, và
 * lọc những module nào" — kiểm được bằng một phép so đối tượng. Dựng sẵn điều kiện Drizzle rồi
 * đi so chuỗi SQL là đi kiểm bản dịch, không kiểm quyết định.
 */
export type PhamViDoc =
  | { kieu: 'tat_ca' }
  /** Lọc: `reporter_id = người đọc` **HOẶC** `module` nằm trong danh sách. Danh sách rỗng là
   *  hợp lệ — khi đó chỉ còn nhánh người báo, đúng ý §6.2b. */
  | { kieu: 'loc'; module: string[] };

/** Danh sách module SẮP sẵn: cùng một vai phải ra cùng một câu SQL giữa hai lượt chạy. */
export function phamViDoc(roleKey: string): PhamViDoc {
  const pv = moduleXemDuoc(roleKey);
  if (pv.tatCa) return { kieu: 'tat_ca' };
  return { kieu: 'loc', module: [...pv.module].sort() };
}
