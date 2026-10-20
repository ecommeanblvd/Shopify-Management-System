/**
 * THUẦN: bảng có ĐANG GHI nhật ký không, và câu nói ra khi không có dòng nào để hiện.
 *
 * Vì sao phải có tệp này: tới 20/10/2026 chỉ `goods_receipt_items` có trigger đang sống,
 * nên bốn module còn lại mở panel ra là trống. Câu cũ của trang `/f/nhat-ky` nói "trigger
 * của bảng CÓ THỂ chưa được bật" — chữ "có thể" làm người đọc không phân biệt được hai
 * chuyện ngược hẳn nhau: "không ai sửa gì" (dữ liệu nguyên vẹn) và "chưa bật nên không
 * ghi gì" (có thể đã bị sửa mà không ai biết). Đúng cái mà cả tính năng nhật ký dựng ra
 * để tránh. Nên câu chữ phải dứt khoát, và muốn dứt khoát thì phải TRA `pg_trigger`.
 *
 * Tách khỏi `.tsx` và khỏi tệp chạy SQL vì `vitest` không bắt `.tsx` và không chạm được
 * CSDL (xem `vitest.config.ts`): phần quyết định CÂU CHỮ nằm ở đây để có test, phần đọc
 * `pg_trigger` nằm ở `doc-panel.ts`.
 */

/** Một bảng của panel: tên thật, nhãn tiếng Việt đang hiện, và có trigger đang ghi không. */
export interface TrangThaiBang {
  bang: string;
  /** Nhãn người đọc thấy (`nhanBang`) — truyền vào thay vì tra ở đây để tệp này thuần. */
  nhan: string;
  daGhi: boolean;
}

/**
 * Tên trigger nhật ký của một bảng.
 *
 * Phải khớp ĐÚNG tên mà `sinhTrigger` đặt (`CREATE TRIGGER nhat_ky_<bang>`): lệch một ký
 * tự là câu tra `pg_trigger` không thấy gì, và màn hình đi nói "chưa bật" cho một bảng
 * đang ghi — tức là lại nói sai, chỉ sai theo chiều khác.
 */
export function tenTrigger(bang: string): string {
  return `nhat_ky_${bang}`;
}

/**
 * `pg_trigger.tgenabled` → "trigger này có đang ghi thật hay không".
 *
 * Không có dòng nào trong `pg_trigger` (undefined / null) nghĩa là chưa bật bao giờ.
 * `'D'` là trigger CÓ đó nhưng đang bị tắt bằng `ALTER TABLE … DISABLE TRIGGER` — nó
 * không ghi một dòng nào, nên coi nó là "đã bật" là nói sai với người đọc. Phần còn lại
 * (`'O'` origin, `'A'` always, `'R'` replica) đều là đang bật.
 */
export function dangGhi(tgenabled: string | null | undefined): boolean {
  return typeof tgenabled === 'string' && tgenabled !== 'D';
}

/**
 * Câu khi CHÍNH LƯỢT TRA `pg_trigger` lỗi — ca thứ ba, không được gộp vào hai ca kia.
 *
 * Không biết thì phải nói là không biết. Rơi về "chưa bật" là vu cho hệ thống đang không
 * ghi (người ta đi bật lại một trigger đang sống); rơi về "đã bật" là nói với người đọc
 * rằng im lặng nghĩa là không ai sửa — đúng cái kết luận sai mà cả tính năng này dựng ra
 * để tránh. Cả hai đều tệ hơn một câu thú nhận.
 */
export const CAU_KHONG_TRA_DUOC = 'Không tra được bảng này có đang ghi nhật ký hay không, '
  + 'nên chưa kết luận được là chưa bật hay đã bật mà chưa ai sửa. '
  + 'Mở lại; nếu vẫn thế thì báo kỹ thuật.';

function nhanCua(ds: readonly TrangThaiBang[]): string {
  return ds.map((t) => t.nhan).join(', ');
}

/**
 * Câu hiện khi panel không có khối nào — DỨT KHOÁT, không có chữ "có thể".
 *
 * Ba ca, vì một module có thể soi nhiều bảng (vd Kho hàng soi cả `goods_receipts` lẫn
 * `goods_receipt_items`) và hai bảng đó bật/tắt độc lập:
 *  - không bảng nào ghi  → nói thẳng là chưa bật, và nói rõ im lặng này KHÔNG phải bằng
 *    chứng rằng không ai sửa;
 *  - mọi bảng đều ghi    → nói thẳng là đã bật, nên trống đúng nghĩa là chưa ai sửa;
 *  - nửa nọ nửa kia      → phải kể TÊN bảng nào bật bảng nào chưa, vì một câu gộp
 *    ("đã bật") sẽ che mất đúng nửa đang không được ghi.
 */
export function cauKhiTrong(ds: readonly TrangThaiBang[]): string {
  /* Người gọi lọc tên bảng lạ trước khi tới đây nên danh sách rỗng chỉ xảy ra khi một
     module khai sai tên bảng. Nói ra chứ không trả chuỗi rỗng: một panel trống trơn
     không chữ nào là ca khó lần nhất. */
  if (ds.length === 0) return 'Chưa khai bảng nào cho panel này, nên không có nhật ký để đọc.';

  const bat = ds.filter((t) => t.daGhi);
  const chua = ds.filter((t) => !t.daGhi);

  if (bat.length === 0) {
    return ds.length === 1
      ? 'Chưa bật ghi nhật ký cho bảng này. Có ai sửa hay không thì cũng không có gì được ghi.'
      : `Chưa bật ghi nhật ký cho ${nhanCua(ds)}. Có ai sửa hay không thì cũng không có gì được ghi.`;
  }
  if (chua.length === 0) {
    return ds.length === 1
      ? 'Đã bật ghi nhật ký cho bảng này, và chưa có thay đổi nào được ghi.'
      : `Đã bật ghi nhật ký cho ${nhanCua(ds)}, và chưa có thay đổi nào được ghi.`;
  }
  return `Đã bật ghi nhật ký cho ${nhanCua(bat)}, và chưa có thay đổi nào được ghi. `
    + `CHƯA bật cho ${nhanCua(chua)} — thay đổi ở đó không được ghi.`;
}
