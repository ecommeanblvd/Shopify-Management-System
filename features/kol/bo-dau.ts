/**
 * THUẦN: bỏ dấu tiếng Việt + hạ chữ thường, ĐÚNG cùng phép biến đổi với cột
 * sinh `shopify_variants.tim_kiem` (migration 0163).
 *
 * Hai bên PHẢI khớp nhau từng ký tự: cột đã bỏ dấu mà từ khoá còn dấu thì gõ
 * "áo dài" không bao giờ khớp nổi "ao dai" đã lưu. Có test canh việc này.
 */
const TU_CO_DAU = 'áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵ';
const THANH_KHONG_DAU = 'aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyy';

const BANG_BO_DAU = new Map<string, string>(
  [...TU_CO_DAU].map((c, i) => [c, THANH_KHONG_DAU[i]!]),
);

export function boDauTiengViet(s: string): string {
  return [...s.toLowerCase()].map((c) => BANG_BO_DAU.get(c) ?? c).join('');
}
