import { describe, it, expect } from 'vitest';
import {
  LUONG_CUNG, QUY_P1_TONG, TRONG_SO_P1, bangDiemKpi, diemBienCuoc, diemDonHoanHao, diemSizeThung, diemSla, heSoK,
  thuongShipHo, thuongTheoNac, thuongThuHoi, tinhBangLuong, diemSlaTheoKy, nguongDatKy, heSoChatLuongP2, type DauVaoKpi,
} from './quy-che';

const KY_2026 = '2026-09-01'; // lộ trình khởi động: lỗi ≤35 % → ngưỡng đạt 65 %

describe('quy-che KPI logistics', () => {
  it('lương cứng và quỹ Pillar 1 đúng quy chế', () => {
    expect(LUONG_CUNG).toBe(10_500_000);
    expect(QUY_P1_TONG).toBe(1_200_000);
  });
  it('1.1 biên cước: chấm theo TỈ LỆ TIỀN rò rỉ, trên 2 % mất sạch (CEO 30/09/2026)', () => {
    expect(diemBienCuoc(0).mucNhan).toBe(1);
    expect(diemBienCuoc(0.005).mucNhan).toBe(1);
    expect(diemBienCuoc(0.0051).mucNhan).toBe(0.75);
    expect(diemBienCuoc(0.01).mucNhan).toBe(0.75);
    expect(diemBienCuoc(0.015).mucNhan).toBe(0.5);
    expect(diemBienCuoc(0.02).mucNhan).toBe(0.5);
    // CEO: "lệch trên 2 % đã là không chấp nhận được rồi".
    expect(diemBienCuoc(0.0201).mucNhan).toBe(0);
    expect(diemBienCuoc(0.023).mucNhan).toBe(0); // số thật tháng 8
    expect(diemBienCuoc(null).mucNhan).toBe(0);
  });
  it('1.2 SLA: bậc 95/90/85', () => {
    expect(diemSla(0.96).tien).toBe(360_000);
    expect(diemSla(0.95).tien).toBe(360_000);
    expect(diemSla(0.9499).tien).toBe(270_000);
    expect(diemSla(0.87).tien).toBe(180_000);
    expect(diemSla(0.8499).tien).toBe(0);
    expect(diemSla(null).tien).toBe(0);
  });
  it('1.3 đơn hoàn hảo: ≤2 % full, >2–5 % 70 %, >5 % mất', () => {
    expect(diemDonHoanHao(0.015).tien).toBe(360_000);
    expect(diemDonHoanHao(0.02).tien).toBe(360_000);
    expect(diemDonHoanHao(0.05).tien).toBe(252_000);
    expect(diemDonHoanHao(0.0501).tien).toBe(0);
  });
  it('1.4 size thùng: ≥98 % full, 95–98 % nửa', () => {
    expect(diemSizeThung(0.99).tien).toBe(120_000);
    expect(diemSizeThung(0.97).tien).toBe(60_000); // ví dụ trong quy chế
    expect(diemSizeThung(0.94).tien).toBe(0);
    expect(diemSizeThung(null).tien).toBe(0);
  });
  it('P2 ship hộ: 15.000đ tới đơn 150, 18.000đ phần vượt', () => {
    expect(thuongShipHo(80).tien).toBe(1_200_000); // ví dụ trong quy chế
    expect(thuongShipHo(150).tien).toBe(2_250_000);
    expect(thuongShipHo(151).tien).toBe(2_268_000);
    expect(thuongShipHo(0).tien).toBe(0);
  });
  it('3C nấc lũy tiến và hệ số K theo đúng quy chế', () => {
    expect(thuongTheoNac(25_000_000)).toBe(0);
    expect(thuongTheoNac(50_000_000)).toBe(200_000);
    expect(thuongTheoNac(55_000_000)).toBe(300_000);
    expect(thuongTheoNac(100_000_000)).toBe(1_500_000);
    expect(heSoK(0.917)).toBe(1.0);
    expect(heSoK(0.85)).toBe(0.8);
    expect(heSoK(0.5)).toBe(0.6);
    expect(thuongThuHoi(55_000_000, 0.917).tien).toBe(300_000);
    expect(thuongThuHoi(55_000_000, 0.85).tien).toBe(240_000);
  });
  it('trượt Gate thì mất toàn bộ Pillar 3', () => {
    const v: DauVaoKpi = {
      soDonAmCuocChuaXet: 0, tyLeBienCuocRoRi: 0, soDonAmCuocLoi: 0, tyLeSla: 0.96, tyLeLoiChungTu: 0.01, tyLeSizeThung: 0.99, thietHaiChamDiemVnd: 0, soDonShipHo: 10,
      gateDat: false, roRiGiam: true, khacPhucGoc: true, thuHoiVnd: 100_000_000, tyLeThuHoi: 1, clawbackVnd: 0,
    };
    expect(tinhBangLuong(v).p3).toBe(0);
    expect(tinhBangLuong({ ...v, gateDat: true }).p3).toBe(1_800_000);
  });
  it('bảng điểm KPI: trọng số 30/30/30/10, điểm P1 = Σ trọng số × mức đạt', () => {
    expect(TRONG_SO_P1.bienCuoc + TRONG_SO_P1.sla + TRONG_SO_P1.hoanHao + TRONG_SO_P1.sizeThung).toBeCloseTo(1, 10);
    /* Ví dụ tháng 7 trong quy chế, DỰNG LẠI theo cách chấm mới: 1.1 nay đo bằng tỉ lệ tiền rò
       rỉ chứ không đếm đơn, nên lấy 0,4 % (dưới ngưỡng 0,5 %) để tiêu chí đạt đủ.
       SLA 96 % (100 %), lỗi chứng từ 1,5 % (100 %), size 97 % (50 %). */
    const b = bangDiemKpi({
      soDonAmCuocChuaXet: 0, tyLeBienCuocRoRi: 0.004, soDonAmCuocLoi: 1, tyLeSla: 0.96, tyLeLoiChungTu: 0.015, tyLeSizeThung: 0.97, thietHaiChamDiemVnd: 0, soDonShipHo: 80,
      // `daChamP3B` nói rằng quản lý ĐÃ chấm hai mục 3B — ví dụ trong quy chế là kỳ đã có kết luận.
      // Thiếu cờ này thì 3B để trống, đúng luật 29/09: chưa ai chấm thì không được vẽ thành đạt hay trượt.
      gateDat: true, roRiGiam: true, khacPhucGoc: true, daChamP3B: true, thuHoiVnd: 55_000_000, tyLeThuHoi: 0.917, clawbackVnd: 0,
    }, KY_2026);
    expect(b.p1.map((d) => d.mucDat)).toEqual([1, 1, 1, 0.5]);
    expect(b.diemP1).toBeCloseTo(0.3 + 0.3 + 0.3 + 0.1 * 0.5, 10); // = 0,95
    expect(b.p3.every((d) => d.mucDat === 1)).toBe(true);
  });
  it('bảng điểm: tiêu chí chưa có dữ liệu để mức đạt null và tính 0 điểm; trượt Gate thì Pillar 3 về 0', () => {
    const b = bangDiemKpi({
      soDonAmCuocChuaXet: 0, tyLeBienCuocRoRi: 0, soDonAmCuocLoi: 0, tyLeSla: null, tyLeLoiChungTu: null, tyLeSizeThung: null, thietHaiChamDiemVnd: 0, soDonShipHo: 0,
      gateDat: false, roRiGiam: true, khacPhucGoc: true, thuHoiVnd: 90_000_000, tyLeThuHoi: 1, clawbackVnd: 0,
    }, KY_2026);
    expect(b.p1.map((d) => d.mucDat)).toEqual([1, null, null, null]);
    expect(b.diemP1).toBeCloseTo(0.3, 10); // chỉ 1.1 đạt
    expect(b.p3.map((d) => d.mucDat)).toEqual([0, 0, 0, 0]);
  });
  it('1.2 chấm theo NGƯỠNG CỦA KỲ, siết dần cùng lộ trình SOP (SLA trong văn bản chỉ là mẫu)', () => {
    expect(nguongDatKy('2026-09-01')).toBeCloseTo(0.65, 10); // lỗi ≤35 %
    expect(nguongDatKy('2027-02-01')).toBeCloseTo(0.85, 10);
    expect(nguongDatKy('2027-11-01')).toBeCloseTo(0.90, 10);
    // Kỳ khởi động: 84 % vượt ngưỡng 65 % → đủ; cùng con số đó ở Q1/2027 (ngưỡng 85 %) còn 75 %,
    // và ở Q4/2027 (ngưỡng 90 %) chỉ còn 50 %.
    expect(diemSlaTheoKy(0.84, '2026-09-01').mucNhan).toBe(1);
    expect(diemSlaTheoKy(0.84, '2027-02-01').mucNhan).toBe(0.75);
    expect(diemSlaTheoKy(0.84, '2027-11-01').mucNhan).toBe(0.5);
    expect(diemSlaTheoKy(0.62, '2026-09-01').mucNhan).toBe(0.75); // thiếu 3 điểm
    expect(diemSlaTheoKy(0.56, '2026-09-01').mucNhan).toBe(0.5);  // thiếu 9 điểm
    expect(diemSlaTheoKy(0.50, '2026-09-01').mucNhan).toBe(0);
    expect(diemSlaTheoKy(null, '2026-09-01').mucNhan).toBe(0);
  });
  it('ví dụ tháng 7/2026 dựng lại theo cách chấm 1.1 MỚI', () => {
    /* Bản quy chế gốc cho 13.404.000đ với 1 đơn âm cước (1.1 còn 324.000đ). Cách chấm mới đo
       tỉ lệ tiền: 0,4 % dưới ngưỡng 0,5 % nên 1.1 đủ 360.000đ, tổng nhích thêm 36.000đ. */
    const { p1, p2, p3, tong } = tinhBangLuong({
      soDonAmCuocChuaXet: 0, tyLeBienCuocRoRi: 0.004, soDonAmCuocLoi: 1, tyLeSla: 0.96, tyLeLoiChungTu: 0.015, tyLeSizeThung: 0.97, thietHaiChamDiemVnd: 0, soDonShipHo: 80,
      gateDat: true, roRiGiam: true, khacPhucGoc: true, thuHoiVnd: 55_000_000, tyLeThuHoi: 0.917, clawbackVnd: 0,
    });
    expect(p1).toBe(1_140_000);
    expect(p2).toBe(1_200_000);
    expect(p3).toBe(600_000);
    expect(tong).toBe(13_440_000);
  });
});

describe('hệ số chất lượng Pillar 2 (CEO 12/09/2026)', () => {
  it('không sự cố thì giữ nguyên thưởng sản lượng', () => {
    expect(heSoChatLuongP2(0).heSo).toBe(1);
    expect(thuongShipHo(59).tien).toBe(885_000);
    expect(thuongShipHo(59, 0).tien).toBe(885_000);
  });

  it('bốn bậc theo thiệt hại quy điểm', () => {
    expect(heSoChatLuongP2(500_000).heSo).toBe(0.8);
    expect(heSoChatLuongP2(1_000_000).heSo).toBe(0.5);
    expect(heSoChatLuongP2(3_000_000).heSo).toBe(0.25);
    expect(heSoChatLuongP2(5_000_000).heSo).toBe(0);
    expect(heSoChatLuongP2(20_000_000).heSo).toBe(0);
  });

  it('vụ ship sai địa chỉ T8: 59 đơn mất sạch 885.000đ', () => {
    // Thiệt hại thật 10tr, loại sai địa chỉ nhân 2 → 20tr, rơi bậc trên 5tr.
    expect(thuongShipHo(59, 20_000_000).tien).toBe(0);
    expect(thuongShipHo(59, 20_000_000).mucNhan).toBe(0);
  });

  it('hệ số chỉ nhân XUỐNG, làm nhiều đơn không được thưởng hai lần', () => {
    expect(thuongShipHo(200, 0).tien).toBe(150 * 15_000 + 50 * 18_000);
    expect(thuongShipHo(200, 0).mucNhan).toBeLessThanOrEqual(1);
  });

  it('sự cố nhỏ vẫn giữ phần lớn thưởng — không đánh sập vì lỗi con', () => {
    expect(thuongShipHo(59, 300_000).tien).toBe(708_000);
  });
});

describe('1.1 chưa phân định xong thì CHƯA CHẤM (CEO 14/09/2026)', () => {
  const day = (over: Partial<DauVaoKpi> = {}): DauVaoKpi => ({
    soDonAmCuocLoi: 0, soDonAmCuocChuaXet: 0, tyLeBienCuocRoRi: 0, tyLeSla: 1, tyLeLoiChungTu: 0, tyLeSizeThung: 1,
    soDonShipHo: 0, thietHaiChamDiemVnd: 0, gateDat: true, roRiGiam: false, khacPhucGoc: false,
    thuHoiVnd: 0, tyLeThuHoi: null, clawbackVnd: 0, ...over,
  });

  it('còn đơn chưa phân định → mức đạt để TRỐNG, không cho điểm tuyệt đối', () => {
    const b = bangDiemKpi(day({ soDonAmCuocChuaXet: 48 }), KY_2026);
    expect(b.p1[0].mucDat).toBeNull();
    expect(b.p1[0].soLieu).toContain('CÒN 48 đơn chưa phân định');
  });

  it('phân định hết rồi mới chấm, và chấm theo TỈ LỆ TIỀN chứ không theo số đơn', () => {
    expect(bangDiemKpi(day(), KY_2026).p1[0].mucDat).toBe(1);
    // Số ĐƠN không còn đổi điểm: 2 đơn hay 46 đơn mà cùng tỉ lệ tiền thì cùng mức đạt.
    expect(bangDiemKpi(day({ soDonAmCuocLoi: 2 }), KY_2026).p1[0].mucDat).toBe(1);
    expect(bangDiemKpi(day({ soDonAmCuocLoi: 46 }), KY_2026).p1[0].mucDat).toBe(1);
    // Tỉ lệ TIỀN mới là thứ đổi điểm.
    expect(bangDiemKpi(day({ tyLeBienCuocRoRi: 0.015 }), KY_2026).p1[0].mucDat).toBe(0.5);
    expect(bangDiemKpi(day({ tyLeBienCuocRoRi: 0.023 }), KY_2026).p1[0].mucDat).toBe(0);
  });

  it('tiêu chí chưa chấm được thì không cộng điểm P1 — không chứng nhận sạch cho phần chưa kiểm', () => {
    const chuaXet = bangDiemKpi(day({ soDonAmCuocChuaXet: 48 }), KY_2026);
    const daXet = bangDiemKpi(day(), KY_2026);
    expect(daXet.diemP1 - chuaXet.diemP1).toBeCloseTo(TRONG_SO_P1.bienCuoc, 10);
  });
});

describe('3B: "chưa ai chấm" KHÁC "không đạt" (CEO 29/09/2026)', () => {
  const nen = {
    soDonAmCuocLoi: 0, soDonAmCuocChuaXet: 0, tyLeBienCuocRoRi: 0, tyLeSla: 0.95, tyLeLoiChungTu: 0.01,
    tyLeSizeThung: 0.99, soDonShipHo: 0, thietHaiChamDiemVnd: 0,
    thuHoiVnd: 0, tyLeThuHoi: null, clawbackVnd: 0,
  };
  const lay = (ma: string, v: Parameters<typeof bangDiemKpi>[0]) => bangDiemKpi(v, '2026-08-01').p3.find((d) => d.ma === ma)!;

  it('Gate đạt mà chưa ai nhập kết luận → để TRỐNG, không phải "Chưa đạt"', () => {
    const d = lay('3B-1', { ...nen, gateDat: true, roRiGiam: false, khacPhucGoc: false });
    expect(d.mucDat).toBeNull();
    expect(d.soLieu).toBe('Chưa có kết luận của quản lý');
  });

  it('quản lý đã chấm là KHÔNG đạt → mới được hiện "Chưa đạt" và tính 0', () => {
    const d = lay('3B-2', { ...nen, gateDat: true, roRiGiam: false, khacPhucGoc: false, daChamP3B: true });
    expect(d.mucDat).toBe(0);
    expect(d.soLieu).toBe('Chưa đạt');
  });

  it('quản lý đã chấm là đạt → 1', () => {
    const d = lay('3B-1', { ...nen, gateDat: true, roRiGiam: true, khacPhucGoc: true, daChamP3B: true });
    expect(d.mucDat).toBe(1);
    expect(d.soLieu).toBe('Đạt');
  });

  it('trượt Gate thì không xét, bất kể đã chấm hay chưa', () => {
    for (const daCham of [true, false, undefined]) {
      const d = lay('3B-1', { ...nen, gateDat: false, roRiGiam: true, khacPhucGoc: true, daChamP3B: daCham });
      expect(d.mucDat).toBe(0);
      expect(d.soLieu).toBe('Không xét (trượt Gate)');
    }
  });
});

describe('1.1: ô ghi đè để TRỐNG phải khác ghi đè bằng 0 (CEO 29/09/2026)', () => {
  /* Bẫy gốc: cột `so_don_am_cuoc_loi` từng là NOT NULL DEFAULT 0, mà bảng đọc
     `nhap?.soDonAmCuocLoi ?? auto.soDonAmCuocLoiNoiBo` — chỉ cần lưu một dòng cho kỳ là 46 đơn
     biến thành 0. Từ 30/09 số đơn không còn chấm điểm, nhưng nó vẫn HIỆN trên bảng nên vẫn phải
     phân biệt được "chưa ghi đè" với "ghi đè bằng 0". */
  const nen = {
    soDonAmCuocChuaXet: 0, tyLeBienCuocRoRi: 0.004, tyLeSla: 0.95, tyLeLoiChungTu: 0.01,
    tyLeSizeThung: 0.99, soDonShipHo: 0, thietHaiChamDiemVnd: 0, gateDat: true,
    roRiGiam: false, khacPhucGoc: false, thuHoiVnd: 0, tyLeThuHoi: null, clawbackVnd: 0,
  };
  const lay = (soDonAmCuocLoi: number) => bangDiemKpi({ ...nen, soDonAmCuocLoi }, '2026-08-01').p1[0];

  it('số đơn vẫn hiện trên bảng để biết quy mô', () => {
    expect(lay(46).soLieu).toContain('46 đơn');
    expect(lay(0).soLieu).toContain('0 đơn');
  });

  it('nhưng số đơn KHÔNG còn đổi mức đạt — điểm do tỉ lệ tiền quyết', () => {
    expect(lay(0).mucDat).toBe(lay(46).mucDat);
    expect(lay(46).mucDat).toBe(1);
  });
});

describe('1.1 đo bằng TỈ LỆ TIỀN (CEO 30/09/2026)', () => {
  const nen = {
    soDonAmCuocLoi: 46, tyLeSla: 0.95, tyLeLoiChungTu: 0.01, tyLeSizeThung: 0.99, soDonShipHo: 0,
    thietHaiChamDiemVnd: 0, gateDat: true, roRiGiam: false, khacPhucGoc: false,
    thuHoiVnd: 0, tyLeThuHoi: null, clawbackVnd: 0,
  };
  const lay = (tyLe: number | null, chuaXet = 0) =>
    bangDiemKpi({ ...nen, tyLeBienCuocRoRi: tyLe, soDonAmCuocChuaXet: chuaXet }, '2026-08-01').p1[0];

  it('số thật tháng 8: 2,3 % → MẤT SẠCH, vì CEO chốt trên 2 % là không chấp nhận được', () => {
    expect(lay(0.023).mucDat).toBe(0);
    expect(lay(0.023).soLieu).toContain('2.3 %');
    expect(lay(0.023).soLieu).toContain('46 đơn');
  });

  it('bốn bậc đúng như CEO chốt', () => {
    expect(lay(0.004).mucDat).toBe(1);
    expect(lay(0.008).mucDat).toBe(0.75);
    expect(lay(0.018).mucDat).toBe(0.5);
    expect(lay(0.021).mucDat).toBe(0);
  });

  it('ngưỡng nói rõ đo bằng TIỀN, không mở đầu bằng con số kèm đơn vị', () => {
    expect(lay(0.004).nguong.startsWith('0 đơn')).toBe(false);
    expect(lay(0.004).nguong).toContain('TIỀN rò rỉ / tổng cước');
  });

  it('phân định hết rồi thì THÔI nhắc "chưa chấm được"', () => {
    expect(lay(0.004).nguong).not.toContain('chưa chấm được');
    expect(lay(0.004, 27).nguong).toContain('chưa chấm được');
    expect(lay(0.004, 27).mucDat).toBeNull();
  });

  it('SỐ ĐƠN không còn đổi điểm — đó là cả lý do đổi cách chấm', () => {
    const it = bangDiemKpi({ ...nen, soDonAmCuocLoi: 1, tyLeBienCuocRoRi: 0.018, soDonAmCuocChuaXet: 0 }, '2026-08-01').p1[0];
    const nhieu = bangDiemKpi({ ...nen, soDonAmCuocLoi: 46, tyLeBienCuocRoRi: 0.018, soDonAmCuocChuaXet: 0 }, '2026-08-01').p1[0];
    expect(it.mucDat).toBe(nhieu.mucDat);
  });

  it('chưa đo được tỉ lệ thì nói rõ, không coi là 0 %', () => {
    expect(lay(null).soLieu).toContain('Chưa đo được');
  });
});

describe('2A sản lượng: "không chấm" KHÁC "chưa chấm được" (CEO 30/09/2026)', () => {
  const b = bangDiemKpi({
    soDonAmCuocLoi: 0, soDonAmCuocChuaXet: 0, tyLeBienCuocRoRi: 0, tyLeSla: 0.9, tyLeLoiChungTu: 0.01, tyLeSizeThung: 0.99,
    soDonShipHo: 46, thietHaiChamDiemVnd: 0, gateDat: true, roRiGiam: true, khacPhucGoc: true,
    daChamP3B: true, thuHoiVnd: 0, tyLeThuHoi: null, clawbackVnd: 0,
  }, '2026-09-01');
  const p2a = b.p2.find((d) => d.ma === '2A')!;

  it('sản lượng đánh dấu KHÔNG CHẤM — nó chỉ đếm đơn, không có ngưỡng đạt/trượt', () => {
    expect(p2a.khongCham).toBe(true);
    expect(p2a.mucDat).toBeNull();
    expect(p2a.soLieu).toBe('46 đơn');
  });

  it('các dòng còn lại KHÔNG bị đánh dấu — chỉ 2A là dòng chỉ-đếm', () => {
    const khac = [...b.p1, ...b.p3, ...b.p2.filter((d) => d.ma !== '2A')];
    expect(khac.every((d) => !d.khongCham)).toBe(true);
  });

  it('2B vẫn chấm bình thường — chất lượng có ngưỡng', () => {
    expect(b.p2.find((d) => d.ma === '2B')!.khongCham).toBeUndefined();
    expect(b.p2.find((d) => d.ma === '2B')!.mucDat).toBe(1);
  });
});
