import { describe, it, expect } from 'vitest';
import { xemTruocGhiGia } from '@/features/lark/ghi-nguoc/patch-gia-uoc-tinh';
import { COT, COT_CHI_PHI } from '@/features/lark/ghi-nguoc/cot';
import type { GiaUocTinh } from './gia-uoc-tinh';
import {
  cauTomTat, moTaODich, moTaOTracking, nhanLarkDangCo, nhomXemTruoc, soInDam, tenNguon,
  tongUocTinh, vnd,
} from './xem-truoc-van-don';

const g = {
  nguon: 'bang-gia', base: 100, discount: null, fuel: 20, remote: 0, demand: null,
  signature: null, residential: null, importHandling: null, vat: 10, total: 130,
} as GiaUocTinh;

describe('vnd', () => {
  /* "Không biết" và "bằng không" là hai việc khác nhau ở đường ghi này — hiện `0` cho ô mà
   * nguồn im lặng là nói sai, và người đọc sẽ tưởng hãng không thu khoản đó. */
  it('null hiện — chứ không hiện 0', () => {
    expect(vnd(null)).toBe('—');
    expect(vnd(0)).toContain('0');
  });
  it('số lớn có phân cách để đọc được bằng mắt', () => {
    expect(vnd(1_877_160)).toMatch(/1.877.160/);
  });
});

describe('nhomXemTruoc', () => {
  const xem = xemTruocGhiGia(g, { [COT_CHI_PHI.fuel]: 999 }, 'T1');

  it('ba nhóm theo thứ tự cần đọc: sẽ ghi / đã có số / nguồn không có', () => {
    const n = nhomXemTruoc(xem);
    expect(n.seGhi.map((d) => d.cot)).toContain(COT_CHI_PHI.base);
    expect(n.daCo.map((d) => d.cot)).toEqual([COT_CHI_PHI.fuel]);
    expect(n.khongCo.map((d) => d.cot)).toContain(COT_CHI_PHI.remote);
  });
  /* Không ô nào được rơi khỏi cả ba nhóm: ô bị bỏ quên là ô nhân sự không bao giờ thấy, mà
   * cái họ không thấy thì họ không chặn được. */
  it('mọi ô đích đều thuộc đúng một nhóm, không ô nào rơi ra ngoài', () => {
    const n = nhomXemTruoc(xem);
    expect(n.seGhi.length + n.daCo.length + n.khongCo.length).toBe(xem.dong.length);
  });
});

describe('moTaODich', () => {
  it('ô sẽ ghi nói ra SỐ sẽ ghi', () => {
    const d = xemTruocGhiGia(g, {}, null).dong.find((x) => x.cot === COT_CHI_PHI.base)!;
    expect(moTaODich(d)).toMatch(/sẽ ghi/);
    expect(moTaODich(d)).toMatch(/100/);
  });
  /* Người đọc cần SỐ CŨ để quyết định có vào Lark sửa tay hay không — chỉ nói "không ghi" là
   * bắt họ tự mở Lark ra xem. */
  it('ô đã có số nói ra số Lark đang giữ VÀ số ước tính', () => {
    const d = xemTruocGhiGia(g, { [COT_CHI_PHI.base]: 999 }, null).dong
      .find((x) => x.cot === COT_CHI_PHI.base)!;
    expect(moTaODich(d)).toMatch(/999/);
    expect(moTaODich(d)).toMatch(/100/);
  });
  it('ô Lark không đọc được thành số thì bảo kiểm bằng mắt', () => {
    const d = xemTruocGhiGia(g, { [COT_CHI_PHI.base]: '4,747,300' }, null).dong
      .find((x) => x.cot === COT_CHI_PHI.base)!;
    expect(moTaODich(d)).toMatch(/bằng mắt/);
  });
  /* Ô trống ở hai khoản "theo ca" (Phụ phí xử lý hàng, Phí sửa địa chỉ) là ĐÚNG, không phải
   * bug — câu chữ phải nói ra điều đó, nếu không nhân sự báo lỗi mỗi lần nhập mã. */
  it('nguồn không có khoản → nói rõ để trống là đúng, không quy về 0', () => {
    const d = xemTruocGhiGia(g, {}, null).dong.find((x) => x.cot === COT_CHI_PHI.demand)!;
    expect(moTaODich(d)).toMatch(/KHÔNG quy về 0/);
  });
  it('nguồn trả 0 → giải thích vì sao vẫn không ghi', () => {
    const d = xemTruocGhiGia(g, {}, null).dong.find((x) => x.cot === COT_CHI_PHI.remote)!;
    expect(moTaODich(d)).toMatch(/khoá ô/);
  });
});

/* Lỗi CEO bắt được 15/10/2026: cột số đổi NGHĨA theo trạng thái ô — ô Lark trống thì hiện số
 * API, ô Lark đã có số thì hiện số của LARK. Nhân sự chạy "phân tích giá API" mà nhận lại
 * chính con số mình gõ tay, không có gì nói là khác nghĩa. Bộ test này khoá lại: một cột, một
 * nghĩa. */
describe('soInDam', () => {
  it('ô Lark trống → số API', () => {
    const d = xemTruocGhiGia(g, {}, null).dong.find((x) => x.cot === COT_CHI_PHI.base)!;
    expect(soInDam(d)).toMatch(/100/);
  });
  it('ô Lark ĐÃ CÓ SỐ → VẪN là số API, KHÔNG phải số Lark', () => {
    const d = xemTruocGhiGia(g, { [COT_CHI_PHI.base]: 999 }, null).dong
      .find((x) => x.cot === COT_CHI_PHI.base)!;
    expect(soInDam(d)).toMatch(/100/);
    expect(soInDam(d)).not.toMatch(/999/);
  });
  /* Ô Tổng in đậm và dòng "Tổng ước tính" ở đầu hộp thoại PHẢI là cùng một số, kể cả khi ô
   * Tổng trên Lark đã có số khác — hai số đá nhau trên một màn hình là chỗ sinh ra báo lỗi. */
  it('ô Tổng khớp dòng "Tổng ước tính" dù Lark đã có số khác', () => {
    const xem = xemTruocGhiGia(g, { [COT_CHI_PHI.totalAmount]: 1_200_000 }, null);
    const d = xem.dong.find((x) => x.khoan === 'total')!;
    expect(soInDam(d)).toBe(vnd(tongUocTinh(xem)));
  });
  it('nguồn không nói gì → — chứ không phải 0', () => {
    const d = xemTruocGhiGia(g, {}, null).dong.find((x) => x.cot === COT_CHI_PHI.demand)!;
    expect(soInDam(d)).toBe('—');
  });
});

describe('nhanLarkDangCo', () => {
  it('ô Lark trống → không có nhãn phụ nào', () => {
    const d = xemTruocGhiGia(g, {}, null).dong.find((x) => x.cot === COT_CHI_PHI.base)!;
    expect(nhanLarkDangCo(d)).toBeNull();
  });
  it('ô đã có số → nhãn phụ nêu số Lark đang giữ', () => {
    const d = xemTruocGhiGia(g, { [COT_CHI_PHI.base]: 999 }, null).dong
      .find((x) => x.cot === COT_CHI_PHI.base)!;
    expect(nhanLarkDangCo(d)).toMatch(/999/);
  });
  /* Ca này cũng KHÔNG bị ghi đè, và là ca duy nhất buộc phải mở Lark xem bằng mắt — nhãn
   * phụ không được im lặng chỉ vì đọc không ra số. */
  it('ô Lark không đọc được thành số → vẫn có nhãn phụ', () => {
    const d = xemTruocGhiGia(g, { [COT_CHI_PHI.base]: '4,747,300' }, null).dong
      .find((x) => x.cot === COT_CHI_PHI.base)!;
    expect(nhanLarkDangCo(d)).toMatch(/không đọc được/);
  });
});

describe('moTaOTracking', () => {
  it('Lark trống → sẽ ghi mã', () => {
    expect(moTaOTracking(xemTruocGhiGia(g, {}, 'T1').oTracking)).toMatch(/T1/);
  });
  /* Ca nguy hiểm nhất: DB thành mã mới, Lark giữ mã cũ, rồi lượt đồng bộ kế tiếp ghi mã cũ
   * TRỞ LẠI DB — thao tác của nhân sự bốc hơi. Phải nói ra trước khi họ bấm xác nhận. */
  it('Lark giữ mã khác → nói rõ mã cũ sẽ ghi trở lại DB', () => {
    const c = moTaOTracking(xemTruocGhiGia(g, { [COT.trackingNumber]: 'T-CU' }, 'T-MOI').oTracking);
    expect(c).toMatch(/T-CU/);
    expect(c).toMatch(/trở lại/);
  });
});

describe('cauTomTat', () => {
  it('đếm cả ô mã vận đơn vào số ô sẽ ghi', () => {
    const coMa = cauTomTat(xemTruocGhiGia(g, {}, 'T1'));
    const khongMa = cauTomTat(xemTruocGhiGia(g, {}, null));
    expect(coMa).toMatch(/5 ô/);   // base, fuel, vat, total + ô mã vận đơn
    expect(khongMa).toMatch(/4 ô/);
  });
  /* Bấm xác nhận lúc không còn ô trống VẪN có tác dụng (mã vào CSDL, kiện rời hàng chờ) —
   * câu chữ không được để người dùng tưởng nút chẳng làm gì. */
  it('không còn ô nào để ghi thì nói thẳng, kèm số ô đã có từ trước', () => {
    const c = cauTomTat(xemTruocGhiGia(g, {
      [COT_CHI_PHI.base]: 1, [COT_CHI_PHI.fuel]: 1, [COT_CHI_PHI.vat]: 1,
      [COT_CHI_PHI.totalAmount]: 1, [COT.trackingNumber]: 'T1',
    }, 'T1'));
    expect(c).toMatch(/Không ô nào/);
    expect(c).toMatch(/4 ô đã có số/);
  });
});

describe('tongUocTinh', () => {
  it('lấy đúng khoản tổng để hiện lên đầu hộp thoại', () => {
    expect(tongUocTinh(xemTruocGhiGia(g, {}, null))).toBe(130);
  });
  it('tổng mà nguồn không có thì null, không phải 0', () => {
    expect(tongUocTinh(xemTruocGhiGia({ ...g, total: null } as GiaUocTinh, {}, null))).toBeNull();
  });
});

describe('tenNguon', () => {
  /* Số từ API hãng là giá hợp đồng đang hiệu lực, số từ bảng giá là mình tự tính — hai mức
   * đáng tin khác nhau, mà nhân sự đang được giao việc soi chính con số đó. */
  it('phân biệt API giá sống và bảng giá nội bộ', () => {
    expect(tenNguon('fedex-api')).toMatch(/FedEx/);
    expect(tenNguon('ups-api')).toMatch(/UPS/);
    expect(tenNguon('bang-gia')).toMatch(/bảng giá/);
  });
  it('chưa lấy được giá thì nói "chưa rõ", không im lặng trả chuỗi rỗng', () => {
    expect(tenNguon(null)).toBe('chưa rõ nguồn');
  });
});
