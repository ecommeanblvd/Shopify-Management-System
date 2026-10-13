import { describe, it, expect } from 'vitest';
import { patchGiaUocTinh } from './patch-gia-uoc-tinh';
import { COT_CHI_PHI, COT } from './cot';
import type { GiaUocTinh } from '@/features/dong-hang/gia-uoc-tinh';

describe('patchGiaUocTinh', () => {
  const g = {
    nguon: 'bang-gia', base: 100, discount: null, fuel: 20, remote: null, demand: null,
    signature: null, residential: null, importHandling: null, vat: 10, total: 130,
  } as GiaUocTinh;

  it('ô trống thì điền', () => {
    expect(patchGiaUocTinh(g, {}, null).patch[COT_CHI_PHI.base]).toBe(100);
  });
  /* Anti-goal của spec: không bao giờ đè số người gõ tay. */
  it('ô ĐÃ CÓ số thì KHÔNG đụng', () => {
    const { patch } = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: 999 }, null);
    expect(COT_CHI_PHI.base in patch).toBe(false);
  });
  it('ô có số 0 cũng là ĐÃ CÓ, không đè', () => {
    const { patch } = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: 0 }, null);
    expect(COT_CHI_PHI.base in patch).toBe(false);
  });
  /* Review Focus #3: khoản null = KHÔNG BIẾT → không được ghi 0 vào ô. */
  it('khoản null thì bỏ hẳn khỏi patch, không ghi 0', () => {
    const { patch } = patchGiaUocTinh(g, {}, null);
    expect(COT_CHI_PHI.remote in patch).toBe(false);
  });
  it('ghi mã vận đơn khi ô trống', () => {
    expect(patchGiaUocTinh(g, {}, 'T1').patch[COT.trackingNumber]).toBe('T1');
  });
  it('Lark đã có mã vận đơn KHÁC thì không đè', () => {
    const { patch } = patchGiaUocTinh(g, { [COT.trackingNumber]: 'T-CU' }, 'T-MOI');
    expect(COT.trackingNumber in patch).toBe(false);
  });
  /* CEO đính chính: ô "INS | Chi phí Tổng (đ)" xưa nay là TỔNG ƯỚC TÍNH nhân sự tự gõ tay,
   * không phải số hoá đơn — nên tổng ước tính cũng theo đúng luật chỉ-điền-ô-trống như mọi
   * khoản khác, không bị loại riêng. */
  it('ô tổng trống thì điền', () => {
    expect(patchGiaUocTinh(g, {}, null).patch[COT_CHI_PHI.totalAmount]).toBe(130);
  });
  it('ô tổng ĐÃ CÓ số thì KHÔNG đụng', () => {
    const { patch } = patchGiaUocTinh(g, { [COT_CHI_PHI.totalAmount]: 999 }, null);
    expect(COT_CHI_PHI.totalAmount in patch).toBe(false);
  });
  it('tổng null thì bỏ hẳn khỏi patch, không ghi 0', () => {
    const { patch } = patchGiaUocTinh({ ...g, total: null } as GiaUocTinh, {}, null);
    expect(COT_CHI_PHI.totalAmount in patch).toBe(false);
  });
  it('không có gì để ghi thì patch rỗng', () => {
    const { patch } = patchGiaUocTinh(g, {
      [COT_CHI_PHI.base]: 1, [COT_CHI_PHI.fuel]: 1, [COT_CHI_PHI.vat]: 1, [COT_CHI_PHI.totalAmount]: 1,
    }, null);
    expect(Object.keys(patch)).toEqual([]);
  });

  /* C1 (review coordinator): `getLogRecordById` (GET records/:id) trả ô số dạng CHUỖI,
   * khác `records/search` (dùng SỐ) — đo thật trên record Lark `recv34I1lMBDBt`, ô "Mức
   * giá cơ sở": search → int 4747300, GET records/:id → str '4747300'. Lá chắn phải coi ô
   * CHUỖI SỐ là ĐÃ CÓ, không chỉ ô kiểu number — thiếu bao dung này thì đọc qua
   * GET records/:id sẽ tưởng mọi ô đã điền là TRỐNG và ĐÈ số thật của Đức. */
  it('ô số dạng CHUỖI (đọc qua GET records/:id) vẫn là ĐÃ CÓ, không đè', () => {
    const { patch } = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: '4747300' }, null);
    expect(COT_CHI_PHI.base in patch).toBe(false);
  });
  it('chuỗi "0" vẫn là ĐÃ CÓ (hãng có tính, bằng không), không đè', () => {
    const { patch } = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: '0' }, null);
    expect(COT_CHI_PHI.base in patch).toBe(false);
  });
  it('chuỗi rỗng hoặc chỉ khoảng trắng mới là TRỐNG thật, vẫn điền được', () => {
    expect(patchGiaUocTinh(g, { [COT_CHI_PHI.base]: '' }, null).patch[COT_CHI_PHI.base]).toBe(100);
    expect(patchGiaUocTinh(g, { [COT_CHI_PHI.base]: '   ' }, null).patch[COT_CHI_PHI.base]).toBe(100);
  });

  /* I2: với một LÁ CHẮN, "không phân tích được" phải nghĩa là CÓ, ĐỪNG CHẠM. Mọi hình dưới
   * đây đều làm `docSo` trả null — xét ô trống bằng `docSo` là ĐÈ hết, mà Lark không có undo. */
  it.each([
    ['1.000 phân cách kiểu người gõ', '4,747,300'],
    ['có khoảng trắng', '4 747 300'],
    ['có đuôi đơn vị', '4747300đ'],
    ['mảng rich-text', [{ text: '4747300' }]],
    ['object có value', { value: 4747300 }],
    ['chữ, không phải số', 'chưa rõ'],
  ])('ô không đọc được thành số (%s) vẫn là ĐÃ CÓ, không đè', (_ten, oLark) => {
    const { patch } = patchGiaUocTinh(g, { [COT_CHI_PHI.base]: oLark }, null);
    expect(COT_CHI_PHI.base in patch).toBe(false);
  });

  /* C2: `tuEngine` không bao giờ trả null cho khoản engine không mô hình hoá — nó trả 0. Ghi
   * 0 vào ô "Phí kí nhận trực tiếp" của DHL (hãng thu 150.000đ/kiện) là khoá ô ở 0 VĨNH VIỄN:
   * `dungPatch` sau này đọc `docSo = 0 ≠ null` nên không bao giờ ghi số hoá đơn thật vào được. */
  it('khoản bằng 0 KHÔNG ghi — ghi 0 là khoá ô vĩnh viễn, hoá đơn thật sau này không vào được', () => {
    const { patch } = patchGiaUocTinh({ ...g, signature: 0 } as GiaUocTinh, {}, null);
    expect(COT_CHI_PHI.directSignature in patch).toBe(false);
  });
  it('khoản âm cũng không ghi', () => {
    const { patch } = patchGiaUocTinh({ ...g, remote: -5 } as GiaUocTinh, {}, null);
    expect(COT_CHI_PHI.remote in patch).toBe(false);
  });

  /* Cột tiền trên Lark là VND — quy đổi tiền ra số thập phân (đo thật: tổng 1.877.160,2). */
  it('làm tròn trước khi ghi vào cột tiền VND', () => {
    const { patch } = patchGiaUocTinh({ ...g, total: 1_877_160.2, base: 50.21 } as GiaUocTinh, {}, null);
    expect(patch[COT_CHI_PHI.totalAmount]).toBe(1_877_160);
    expect(patch[COT_CHI_PHI.base]).toBe(50);
  });
  it('khoản nhỏ hơn nửa đồng tròn thành 0 thì không ghi, không khoá ô ở 0', () => {
    const { patch } = patchGiaUocTinh({ ...g, remote: 0.3 } as GiaUocTinh, {}, null);
    expect(COT_CHI_PHI.remote in patch).toBe(false);
  });

  /* I5: Lark giữ T1, nhân sự dán T2 ⇒ DB thành T2 mà Lark vẫn T1, rồi lượt `sync-lark` kế
   * tiếp ghi T1 TRỞ LẠI DB. Im lặng ở đây là thao tác của nhân sự bốc hơi sau một toast xanh. */
  it('Lark đang có mã KHÁC thì cảnh báo rõ, không im lặng', () => {
    const { canhBao } = patchGiaUocTinh(g, { [COT.trackingNumber]: 'T1' }, 'T2');
    expect(canhBao.join(' ')).toContain('T1');
    expect(canhBao.join(' ')).toContain('T2');
  });
  it('Lark có đúng mã đó (khác hoa thường) thì không cảnh báo gì', () => {
    const { canhBao, patch } = patchGiaUocTinh(g, { [COT.trackingNumber]: '1z999aa' }, '1Z999AA');
    expect(COT.trackingNumber in patch).toBe(false);
    expect(canhBao).toEqual([]);
  });
  it('ô tracking có dữ liệu không đọc được thì cảnh báo, KHÔNG ghi đè', () => {
    const { canhBao, patch } = patchGiaUocTinh(g, { [COT.trackingNumber]: { la: 1 } }, 'T2');
    expect(COT.trackingNumber in patch).toBe(false);
    expect(canhBao.join(' ')).toContain('không đọc được');
  });

  /* Patch rỗng mà báo "đã ghi giá" là nói sai việc đã làm. */
  it('patch rỗng vì mọi ô đã có số thì nói rõ ô nào đã có', () => {
    const { canhBao } = patchGiaUocTinh(g, {
      [COT_CHI_PHI.base]: 1, [COT_CHI_PHI.fuel]: 1, [COT_CHI_PHI.vat]: 1, [COT_CHI_PHI.totalAmount]: 1,
    }, null);
    expect(canhBao.join(' ')).toContain(COT_CHI_PHI.base);
  });
  it('tổng ≤ 0 thì không ghi ô Tổng và nói rõ vì sao', () => {
    const { patch, canhBao } = patchGiaUocTinh({ ...g, total: 0 } as GiaUocTinh, {}, null);
    expect(COT_CHI_PHI.totalAmount in patch).toBe(false);
    expect(canhBao.join(' ')).toContain('Tổng');
  });

  /* ───── Ô `Chiết khấu || API` (CEO chốt 13/10/2026, D-245 bản 2) ───── */

  it('chiết khấu ghi vào ô "Chiết khấu || API" khi ô đó trống', () => {
    const { patch } = patchGiaUocTinh({ ...g, discount: 7_657_402 } as GiaUocTinh, {}, null);
    expect(patch[COT_CHI_PHI.discountApi]).toBe(7_657_402);
  });

  /* Luật ô trống áp cho ô này y như mọi ô khác — Lark không có undo. */
  it('ô chiết khấu ĐÃ CÓ số thì KHÔNG đụng', () => {
    const { patch } = patchGiaUocTinh({ ...g, discount: 500 } as GiaUocTinh,
      { [COT_CHI_PHI.discountApi]: 999 }, null);
    expect(COT_CHI_PHI.discountApi in patch).toBe(false);
  });

  /* UPS: Rating API không trả khoản chiết khấu nào ⇒ `null` = KHÔNG BIẾT. Ghi 0 vào đây là
   * khoá ô ở 0 vĩnh viễn, sau này không điền được số thật vào nữa. */
  it('chiết khấu null (UPS) thì bỏ hẳn khỏi patch, không ghi 0', () => {
    const { patch } = patchGiaUocTinh(g, {}, null);
    expect(COT_CHI_PHI.discountApi in patch).toBe(false);
  });

  /* Engine: `contract_discount_pct` hiện 0 dòng trên cả 5 account ⇒ discount = 0. */
  it('chiết khấu 0 (engine chưa có dòng chiết khấu) cũng không ghi', () => {
    const { patch } = patchGiaUocTinh({ ...g, discount: 0 } as GiaUocTinh, {}, null);
    expect(COT_CHI_PHI.discountApi in patch).toBe(false);
  });

  /* Cái bẫy chính của ô này: nếu `GiaUocTinh.discount` theo quy ước ÂM của
   * `shipment_charges.discount` (đo 13/10/2026: 2.898/2.898 dòng có chiết khấu đều âm) thì MỌI
   * kiện rơi vào nhánh `<= 0` và ô không bao giờ được điền — nhìn code thì tưởng đã xong việc.
   * Test này ghim hậu quả đó lại để ai đổi dấu ở nguồn sẽ thấy ngay vì sao không được. */
  it('chiết khấu ÂM không ghi — nguồn PHẢI đưa số dương, nếu không ô này im lặng rỗng mãi', () => {
    const { patch } = patchGiaUocTinh({ ...g, discount: -7_657_402 } as GiaUocTinh, {}, null);
    expect(COT_CHI_PHI.discountApi in patch).toBe(false);
  });

  /* Lark ghi theo TÊN cột, PUT là all-or-nothing ⇒ lệch MỘT ký tự ở tên này là cả bản vá bị
   * từ chối, kể cả những ô chẳng liên quan. Tên dưới đây là nguyên văn đọc từ API fields của
   * bảng LOG ngày 13/10/2026 (`fldY1E45DQ`, type=2): HAI dấu gạch đứng, mỗi bên một khoảng
   * trắng. Ai "dọn" nó thành một gạch cho giống `INS | Chi phí Tổng (đ)` sẽ gãy ở đây trước. */
  it('tên cột đúng từng ký tự: hai dấu gạch đứng, không phải một', () => {
    expect(COT_CHI_PHI.discountApi).toBe('Chiết khấu || API');
    expect(COT_CHI_PHI.discountApi.split('|')).toHaveLength(3); // "Chiết khấu ", "", " API"
  });

  /* Ô `Giá chiết khấu` là Formula của Lark (type=20) — tự tính từ base + các phụ phí. Ghi vào
   * ô công thức là Lark từ chối cả bản vá; và chính vì có công thức đó mà `Mức giá cơ sở` phải
   * là base GỐC. Không được có khoá nào trỏ tới tên ô này. */
  it('KHÔNG có cột nào trỏ tới ô Formula "Giá chiết khấu"', () => {
    expect(Object.values(COT_CHI_PHI)).not.toContain('Giá chiết khấu');
  });

  /* ───────── ô `GoGreen Plus-Basic` (fldXrp2NRG, type=2 — ghi được) ─────────
   * Cột có sẵn trên bảng nhưng đường GIÁ ƯỚC TÍNH chưa bao giờ điền ⇒ ~3.800đ/kiện nằm trong
   * ô Tổng mà không ô thành phần nào đựng, ở 3.033/3.033 kiện DHL. Luật ô trống áp y nguyên. */
  it('ô GoGreen trống thì điền', () => {
    const { patch } = patchGiaUocTinh({ ...g, gogreen: 3_800 } as GiaUocTinh, {}, null);
    expect(patch[COT_CHI_PHI.gogreen]).toBe(3_800);
  });
  it('ô GoGreen ĐÃ CÓ số thì KHÔNG đụng', () => {
    const { patch } = patchGiaUocTinh({ ...g, gogreen: 3_800 } as GiaUocTinh,
      { [COT_CHI_PHI.gogreen]: 28_500 }, null);
    expect(COT_CHI_PHI.gogreen in patch).toBe(false);
  });
  /* FedEx và UPS không có khoản GoGreen nào ⇒ `null` = KHÔNG BIẾT. Ghi 0 là khoá ô ở 0 vĩnh
   * viễn, đường ghi từ HOÁ ĐƠN (`dungPatch`) sau đó không điền được số thật vào nữa. */
  it('GoGreen null (FedEx/UPS) thì bỏ hẳn khỏi patch, không ghi 0', () => {
    const { patch } = patchGiaUocTinh(g, {}, null);
    expect(COT_CHI_PHI.gogreen in patch).toBe(false);
  });
  /* Hãng trên bảng giá mà không có dòng `per_step_fixed` ⇒ engine trả 0. Cùng lý do trên. */
  it('GoGreen 0 (hãng không có dòng per_step) cũng không ghi', () => {
    const { patch } = patchGiaUocTinh({ ...g, gogreen: 0 } as GiaUocTinh, {}, null);
    expect(COT_CHI_PHI.gogreen in patch).toBe(false);
  });
  /* Tên nguyên văn đọc từ API fields 13/10/2026. Lark ghi theo TÊN và PUT là all-or-nothing
   * nên lệch một ký tự (dấu gạch nối, khoảng trắng quanh nó) là cả bản vá bị từ chối. */
  it('tên cột GoGreen đúng từng ký tự', () => {
    expect(COT_CHI_PHI.gogreen).toBe('GoGreen Plus-Basic');
  });

  /* ───────── ô `Phí rủi ro gia tăng` (fld2USMcZo) — CỐ Ý KHÔNG MAP ─────────
   * Đường giá ước tính KHÔNG được ghi ô này, và đây là test khoá chủ ý đó lại chứ không phải
   * việc còn sót.
   *
   * Lý do: nguồn duy nhất có Elevated Risk là engine, và engine phơi nó ra trong MỘT số gộp
   * `countryFixed` cùng 4 khoản khác bản chất (Restricted Destination, phí xử lý hàng nhập
   * US/EU của FedEx, phí xử lý quốc tế UPS, phí hải quan đầu xuất Aramex). Đo
   * `carrier_surcharges` 13/10/2026: 12 dòng `country_fixed`, **0 dòng có `service_key`** —
   * không có trường CẤU TRÚC nào tách được, chỉ còn `note` là chữ người gõ tay.
   *
   * `countryFixed` ĐÃ đi vào ô `Phí xử lý hàng nhập`. Ghi nó vào ô này nữa là cộng 918.000đ
   * HAI LẦN trên 370 kiện DHL — và chính ô này là ô Đức dùng đối chiếu, nên số sai ở đây còn
   * tệ hơn ô để trống (Lark không có undo, phải vào xoá tay từng ô).
   *
   * `reconcile-diagnose.ts` đã chốt cùng quy ước: engine `countryFixed` đối chiếu với TỔNG
   * `elevatedRisk + importHandling` của hoá đơn, tức hệ thống vốn coi đây là một khối không
   * tách. Muốn map đúng thì phải thêm `service_key` cho các dòng `country_fixed` trước. */
  it('đường giá ước tính KHÔNG BAO GIỜ ghi ô "Phí rủi ro gia tăng" (countryFixed là số GỘP)', () => {
    const { patch } = patchGiaUocTinh(
      { ...g, importHandling: 918_000, gogreen: 3_800 } as GiaUocTinh, {}, null);
    expect(patch[COT_CHI_PHI.importHandling]).toBe(918_000);
    expect(COT_CHI_PHI.elevatedRisk in patch).toBe(false);
  });
  /* Cột vẫn PHẢI khai trong `COT_CHI_PHI`: đường ghi từ HOÁ ĐƠN (`dungPatch` lặp
   * `Object.entries(COT_CHI_PHI)` theo tên cột `shipment_charges`) có số Elevated Risk thật và
   * vẫn điền ô này. Xoá khoá đi là làm hỏng đường đó. */
  it('cột "Phí rủi ro gia tăng" vẫn được khai để đường hoá đơn dùng', () => {
    expect(COT_CHI_PHI.elevatedRisk).toBe('Phí rủi ro gia tăng');
  });
});
