/**
 * THUẦN: biến metafield thô của Shopify thành danh sách thuộc tính cho người QC soi.
 *
 * DANH SÁCH CHO PHÉP, không phải danh sách chặn. Đo thật 24/09: 10 sản phẩm trả
 * về 58 metafield khác nhau, phần lớn là rác app — widget đánh giá judge.me dạng
 * HTML hàng nghìn ký tự, `bcpo_data` JSON, badge, swym_wishlist, mm-google-shopping,
 * mc-facebook, theme.*. Dùng danh sách chặn thì app cài thêm cái mới là rác lại
 * tràn vào màn QC.
 */
const NAMESPACE_NHAN = new Set(['custom', 'shopify']);
const KHOA_LOAI_TRU = new Set([
  'return_refund_policy_v2', 'seasonal', 'suggested_item', 'product_return_refund_policy',
  // Văn marketing, không giúp gì cho việc kiểm hàng.
  'occasion', 'dress_occasion', 'dress-occasion', 'target-gender', 'age-group',
]);

/**
 * Thuộc tính ĐẨY LÊN ĐẦU danh sách — thứ người QC soi trước tiên.
 * `special_features` là mô tả do người viết ("Attached bow at waist", "Open back"),
 * sát việc kiểm hàng hơn mọi thuộc tính phân loại khác.
 */
const UU_TIEN = ['special_features', 'sewing_details', 'embellishment_feature', 'closure_type', 'included_component'];
const DAI_TOI_DA = 200;

/** Nhãn tiếng Việt theo thuộc tính LOGIC (đã bỏ hậu tố thế hệ). */
const NHAN: Record<string, string> = {
  special_features: 'Đặc điểm nổi bật', 'color-pattern': 'Màu / hoạ tiết',
  pattern: 'Hoạ tiết', material: 'Chất liệu', materials: 'Chất liệu', fabric: 'Chất liệu',
  apparel_silhouette: 'Dáng', fitting_type: 'Kiểu dáng', neck_style: 'Cổ',
  neckline_type: 'Cổ', neckline: 'Cổ', collar_type: 'Cổ áo',
  sleeve_length: 'Độ dài tay', 'sleeve-length-type': 'Độ dài tay',
  sleeve_type: 'Kiểu tay', sleeveline: 'Đường tay', waistline: 'Cạp',
  waistrise: 'Độ cao cạp', product_length: 'Dáng dài', length: 'Chiều dài',
  'skirt-dress-length-type': 'Dáng dài', closure_type: 'Khoá',
  embellishment_feature: 'Chi tiết trang trí', included_component: 'Phụ kiện kèm',
  lining: 'Lót', lining_description: 'Lót', form_type: 'Form',
  models_measurement: 'Số đo người mẫu', 'dress-style': 'Kiểu váy',
  pocket_type: 'Túi', sewing_details: 'Chi tiết may', 'clothing-features': 'Đặc tính',
  'care-instructions': 'Hướng dẫn bảo quản', size: 'Size',
};

interface CoTen { displayName?: string | null }

export interface MetafieldTho {
  namespace: string;
  key: string;
  value: string | null;
  reference?: CoTen | null;
  /**
   * Shopify trả kiểu CONNECTION `{ nodes: [...] }`, không phải mảng trần.
   * Nhận cả hai: bản đầu chỉ nhận mảng trần nên test xanh mà dữ liệu thật nổ
   * `(m.references ?? []).map is not a function` ngay lượt gọi đầu tiên (24/09).
   */
  references?: CoTen[] | { nodes?: CoTen[] | null } | null;
}

/** Gỡ connection của Shopify về mảng phẳng, chấp nhận cả hai dạng. */
function nodesCua(v: MetafieldTho['references']): CoTen[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  return v.nodes ?? [];
}

export interface DongThuocTinh {
  nhan: string;
  giaTri: string;
  /** Khoá logic — để màn hình xếp thứ tự và để test chỉ đích danh. */
  khoa: string;
}

/**
 * Bỏ hậu tố thế hệ để hai bản cũ/mới gộp về một thuộc tính logic.
 * Shopify của MEAN đang có CẢ `custom.fitting_type` (8/10 sản phẩm) lẫn
 * `custom.fitting_type_v2` (9/10) — không gộp thì màn QC hiện trùng hoặc hiện ô trống.
 */
function khoaLogic(key: string): string {
  return key.replace(/_v2_multi$/, '').replace(/_v2$/, '').replace(/_multi$/, '');
}

function chuDocDuoc(m: MetafieldTho): string | null {
  const nhieu = nodesCua(m.references).map((r) => r?.displayName).filter((x): x is string => Boolean(x));
  if (nhieu.length) return nhieu.join(', ');
  if (m.reference?.displayName) return m.reference.displayName;
  const v = (m.value ?? '').trim();
  if (!v) return null;
  // Còn là gid (một hoặc một mảng) thì chưa quy đổi được — không hiện mã cho người kiểm.
  if (v.includes('gid://')) return null;
  if (v.length > DAI_TOI_DA) return null;
  // Giá trị dạng mảng JSON chuỗi: ["156cm"] → 156cm
  if (v.startsWith('[')) {
    try {
      const arr: unknown = JSON.parse(v);
      if (Array.isArray(arr)) {
        const chu = arr.filter((x): x is string => typeof x === 'string');
        return chu.length ? chu.join(', ') : null;
      }
    } catch { /* không phải JSON — dùng nguyên chuỗi */ }
  }
  return v;
}

export function locThuocTinh(nodes: readonly MetafieldTho[]): { hien: DongThuocTinh[]; soBiCat: number } {
  let soBiCat = 0;
  // khoá logic → { thuộc thế hệ mới?, giá trị }. `_v2` thắng bản cũ bất kể thứ tự mảng.
  const gom = new Map<string, { moi: boolean; giaTri: string }>();

  for (const m of nodes) {
    if (!NAMESPACE_NHAN.has(m.namespace) || KHOA_LOAI_TRU.has(m.key)) { soBiCat += 1; continue; }
    const chu = chuDocDuoc(m);
    if (!chu) { soBiCat += 1; continue; }
    const k = khoaLogic(m.key);
    const laMoi = m.key !== k;
    const cu = gom.get(k);
    // Chưa có → nhận. Đã có bản cũ mà cái này là _v2 → thay. Ngược lại giữ nguyên.
    if (!cu || (laMoi && !cu.moi)) gom.set(k, { moi: laMoi, giaTri: chu });
  }

  /**
   * Gộp lần hai theo NHÃN HIỂN THỊ, không chỉ theo khoá logic.
   *
   * Shopify có nhiều khoá khác nhau cùng nói một chuyện: `material` / `materials`
   * / `fabric` đều là "Chất liệu"; `neck_style` / `neckline_type` / `neckline` đều
   * là "Cổ". Gộp theo khoá thôi thì màn QC hiện "Chất liệu" hai ba lần — đo thật
   * 24/09: 4/5 sản phẩm bị trùng nhãn. Trùng giá trị thì bỏ, khác giá trị thì nối.
   */
  const theoNhan = new Map<string, { khoa: string; giaTri: Set<string> }>();
  for (const [k, v] of gom) {
    const nhan = NHAN[k] ?? k.replace(/_/g, ' ');
    const cu = theoNhan.get(nhan);
    if (cu) { for (const x of v.giaTri.split(', ')) cu.giaTri.add(x); }
    else theoNhan.set(nhan, { khoa: k, giaTri: new Set(v.giaTri.split(', ')) });
  }

  const hien: DongThuocTinh[] = [];
  for (const [nhan, v] of theoNhan) hien.push({ nhan, giaTri: [...v.giaTri].join(', '), khoa: v.khoa });
  // Thứ sát việc kiểm hàng lên đầu; còn lại giữ nguyên thứ tự Shopify trả về.
  hien.sort((a, b) => {
    const ia = UU_TIEN.indexOf(a.khoa), ib = UU_TIEN.indexOf(b.khoa);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return { hien, soBiCat };
}
