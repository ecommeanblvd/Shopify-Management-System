import { describe, it, expect } from 'vitest';
import {
  LUONG_CUNG, QUY_P1_TONG, diemBienCuoc, diemDonHoanHao, diemSizeThung, diemSla, heSoK, thuongShipHo,
  thuongTheoNac, thuongThuHoi, tinhBangLuong, type DauVaoKpi,
} from './quy-che';

describe('quy-che KPI logistics', () => {
  it('lương cứng và quỹ Pillar 1 đúng quy chế', () => {
    expect(LUONG_CUNG).toBe(10_500_000);
    expect(QUY_P1_TONG).toBe(1_200_000);
  });
  it('1.1 biên cước: trừ 36.000đ/đơn, chạm trần 180.000đ', () => {
    expect(diemBienCuoc(0).tien).toBe(360_000);
    expect(diemBienCuoc(1).tien).toBe(324_000); // ví dụ trong quy chế
    expect(diemBienCuoc(5).tien).toBe(180_000);
    expect(diemBienCuoc(20).tien).toBe(180_000); // trần 50 %
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
      soDonAmCuocLoi: 0, tyLeSla: 0.96, tyLeLoiChungTu: 0.01, tyLeSizeThung: 0.99, soDonShipHo: 10,
      gateDat: false, roRiGiam: true, khacPhucGoc: true, thuHoiVnd: 100_000_000, tyLeThuHoi: 1, clawbackVnd: 0,
    };
    expect(tinhBangLuong(v).p3).toBe(0);
    expect(tinhBangLuong({ ...v, gateDat: true }).p3).toBe(1_800_000);
  });
  it('dựng lại đúng ví dụ tháng 7/2026 trong quy chế: 13.404.000đ', () => {
    const { p1, p2, p3, tong } = tinhBangLuong({
      soDonAmCuocLoi: 1, tyLeSla: 0.96, tyLeLoiChungTu: 0.015, tyLeSizeThung: 0.97, soDonShipHo: 80,
      gateDat: true, roRiGiam: true, khacPhucGoc: true, thuHoiVnd: 55_000_000, tyLeThuHoi: 0.917, clawbackVnd: 0,
    });
    expect(p1).toBe(1_104_000);
    expect(p2).toBe(1_200_000);
    expect(p3).toBe(600_000);
    expect(tong).toBe(13_404_000);
  });
});
