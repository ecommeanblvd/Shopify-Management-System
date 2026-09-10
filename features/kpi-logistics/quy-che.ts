/**
 * THUẦN: mã hoá Quy chế Lương & KPI — Logistics Operations Specialist (bản 1.2) thành công thức tính được.
 * Mọi con số dưới đây lấy nguyên từ quy chế; đổi quy chế thì sửa ở đây, không rải rác trong UI.
 *
 * Tổng thu nhập = Lương cứng + Pillar 1 (KPI vận hành) + Pillar 2 (Ship hộ) + Pillar 3 (Đối soát & Thu nợ) − clawback.
 */

export const LUONG_CO_BAN = 5_310_000;
export const PHU_CAP_TRACH_NHIEM = 5_190_000;
export const LUONG_CUNG = LUONG_CO_BAN + PHU_CAP_TRACH_NHIEM; // 10.500.000đ

/** Quỹ từng tiêu chí Pillar 1. */
export const QUY_P1 = { bienCuoc: 360_000, sla: 360_000, hoanHao: 360_000, sizeThung: 120_000 } as const;
export const QUY_P1_TONG = QUY_P1.bienCuoc + QUY_P1.sla + QUY_P1.hoanHao + QUY_P1.sizeThung; // 1.200.000đ

/** 1.1 — mỗi đơn âm cước do lỗi trách nhiệm trừ 10 % quỹ; trần trừ 50 % quỹ. */
export const TRU_MOI_DON_AM_CUOC = 36_000;
export const TRAN_TRU_BIEN_CUOC = 180_000;

export interface MucDat { tien: number; mucNhan: number; dienGiai: string }

/** 1.1 Bảo toàn biên cước. `soDonLoi` = số đơn âm cước ĐÃ quy trách nhiệm cho vị trí này. */
export function diemBienCuoc(soDonLoi: number): MucDat {
  const n = Math.max(0, Math.floor(soDonLoi));
  const tru = Math.min(n * TRU_MOI_DON_AM_CUOC, TRAN_TRU_BIEN_CUOC);
  const tien = QUY_P1.bienCuoc - tru;
  return {
    tien, mucNhan: tien / QUY_P1.bienCuoc,
    dienGiai: n === 0 ? 'Không có đơn âm cước do lỗi trách nhiệm' : `${n} đơn × 36.000đ = trừ ${tru.toLocaleString('vi-VN')}đ${tru === TRAN_TRU_BIEN_CUOC ? ' (chạm trần 50 %)' : ''}`,
  };
}

/** 1.2 SLA giao hàng — bậc theo tỉ lệ đơn đạt SLA. */
export function diemSla(tyLeDat: number | null): MucDat {
  if (tyLeDat == null) return { tien: 0, mucNhan: 0, dienGiai: 'Chưa có kiện nào ghi nhận giao trong kỳ' };
  const p = `${Math.round(tyLeDat * 1000) / 10} %`;
  if (tyLeDat >= 0.95) return { tien: 360_000, mucNhan: 1, dienGiai: `${p} ≥ 95 %` };
  if (tyLeDat >= 0.90) return { tien: 270_000, mucNhan: 0.75, dienGiai: `${p} — bậc 90–95 %` };
  if (tyLeDat >= 0.85) return { tien: 180_000, mucNhan: 0.5, dienGiai: `${p} — bậc 85–90 %` };
  return { tien: 0, mucNhan: 0, dienGiai: `${p} < 85 %` };
}

/** 1.3 Đơn giao hoàn hảo — bậc theo tỉ lệ đơn phát sinh phí do lỗi chứng từ/địa chỉ. */
export function diemDonHoanHao(tyLeLoi: number | null): MucDat {
  if (tyLeLoi == null) return { tien: 0, mucNhan: 0, dienGiai: 'Chưa có dữ liệu bill trong kỳ' };
  const p = `${Math.round(tyLeLoi * 1000) / 10} %`;
  if (tyLeLoi <= 0.02) return { tien: 360_000, mucNhan: 1, dienGiai: `${p} ≤ 2 %` };
  if (tyLeLoi <= 0.05) return { tien: 252_000, mucNhan: 0.7, dienGiai: `${p} — bậc >2–5 %` };
  return { tien: 0, mucNhan: 0, dienGiai: `${p} > 5 %` };
}

/** 1.4 Tuân thủ bảng tra size thùng — bậc theo tỉ lệ đơn kho đóng đúng size. */
export function diemSizeThung(tyLeDung: number | null): MucDat {
  if (tyLeDung == null) return { tien: 0, mucNhan: 0, dienGiai: 'Chưa nhập số liệu audit kho' };
  const p = `${Math.round(tyLeDung * 1000) / 10} %`;
  if (tyLeDung >= 0.98) return { tien: 120_000, mucNhan: 1, dienGiai: `${p} ≥ 98 %` };
  if (tyLeDung >= 0.95) return { tien: 60_000, mucNhan: 0.5, dienGiai: `${p} — bậc 95–98 %` };
  return { tien: 0, mucNhan: 0, dienGiai: `${p} < 95 %` };
}

export const SHIP_HO_MOC = 150;
export const SHIP_HO_DON_GIA = 15_000;
export const SHIP_HO_DON_GIA_VUOT = 18_000;

/** Pillar 2 — thưởng ship hộ theo sản lượng, lũy tiến từ đơn 151. */
export function thuongShipHo(soDon: number): MucDat {
  const n = Math.max(0, Math.floor(soDon));
  const trong = Math.min(n, SHIP_HO_MOC);
  const vuot = Math.max(0, n - SHIP_HO_MOC);
  const tien = trong * SHIP_HO_DON_GIA + vuot * SHIP_HO_DON_GIA_VUOT;
  return {
    tien, mucNhan: 1,
    dienGiai: vuot > 0
      ? `${trong} đơn × 15.000 + ${vuot} đơn × 18.000`
      : `${trong} đơn × 15.000`,
  };
}

export const SAN_THU_HOI = 30_000_000;
export const QUY_P3B = { roRi: 150_000, khacPhucGoc: 150_000 } as const;

/** 3C — thưởng theo nấc tiền thu hồi (chưa nhân hệ số K). */
export function thuongTheoNac(thuHoiVnd: number): number {
  const v = Math.max(0, thuHoiVnd);
  if (v <= SAN_THU_HOI) return 0;
  if (v <= 50_000_000) return 0.01 * (v - SAN_THU_HOI);
  if (v <= 70_000_000) return 200_000 + 0.02 * (v - 50_000_000);
  return 600_000 + 0.03 * (v - 70_000_000);
}

/** Hệ số chất lượng thu hồi K theo tỉ lệ thực thu / tổng thuộc diện khiếu nại. */
export function heSoK(tyLeThuHoi: number | null): number {
  if (tyLeThuHoi == null) return 0.6;
  if (tyLeThuHoi >= 0.90) return 1.0;
  if (tyLeThuHoi >= 0.80) return 0.8;
  return 0.6;
}

/** 3C thực nhận = thưởng theo nấc × K. Làm tròn xuống đồng. */
export function thuongThuHoi(thuHoiVnd: number, tyLeThuHoi: number | null): MucDat {
  const nac = thuongTheoNac(thuHoiVnd);
  const k = heSoK(tyLeThuHoi);
  const tien = Math.floor(nac * k);
  return {
    tien, mucNhan: k,
    dienGiai: nac === 0
      ? `Thu hồi ${Math.round(thuHoiVnd).toLocaleString('vi-VN')}đ ≤ sàn 30 triệu — chưa phát sinh thưởng`
      : `Nấc ${Math.round(nac).toLocaleString('vi-VN')}đ × K ${k.toFixed(1)}`,
  };
}

export interface DauVaoKpi {
  /** 1.1 — số đơn âm cước đã quy trách nhiệm cho vị trí (quản lý chốt). */
  soDonAmCuocLoi: number;
  /** 1.2 — tỉ lệ kiện đạt SLA (0..1). */
  tyLeSla: number | null;
  /** 1.3 — tỉ lệ kiện phát sinh phí do lỗi chứng từ/địa chỉ (0..1). */
  tyLeLoiChungTu: number | null;
  /** 1.4 — tỉ lệ đơn kho đóng đúng size thùng (0..1); null = chưa audit. */
  tyLeSizeThung: number | null;
  /** P2 — số đơn ship hộ thành công. */
  soDonShipHo: number;
  /** P3 Gate — đạt cả hai nghĩa vụ đối soát? Không đạt → mất toàn bộ Pillar 3. */
  gateDat: boolean;
  /** 3B — hai hạng mục 150.000đ. */
  roRiGiam: boolean;
  khacPhucGoc: boolean;
  /** 3C — tiền thu hồi thực tế và tỉ lệ thực thu / tổng thuộc diện khiếu nại. */
  thuHoiVnd: number;
  tyLeThuHoi: number | null;
  /** Clawback kỳ này (đã tính trần 30 % ở ngoài). */
  clawbackVnd: number;
}

export interface DongBangLuong { ma: string; ten: string; soLieu: string; tien: number }

/** Bảng lương KPI một kỳ: từng dòng + tổng. */
export function tinhBangLuong(v: DauVaoKpi): { dong: DongBangLuong[]; p1: number; p2: number; p3: number; tong: number } {
  const bienCuoc = diemBienCuoc(v.soDonAmCuocLoi);
  const sla = diemSla(v.tyLeSla);
  const hoanHao = diemDonHoanHao(v.tyLeLoiChungTu);
  const size = diemSizeThung(v.tyLeSizeThung);
  const shipHo = thuongShipHo(v.soDonShipHo);
  const thuHoi = thuongThuHoi(v.thuHoiVnd, v.tyLeThuHoi);
  const roRi = v.gateDat && v.roRiGiam ? QUY_P3B.roRi : 0;
  const khacPhuc = v.gateDat && v.khacPhucGoc ? QUY_P3B.khacPhucGoc : 0;
  const tien3C = v.gateDat ? thuHoi.tien : 0;

  const dong: DongBangLuong[] = [
    { ma: 'luong-cung', ten: 'Lương cứng', soLieu: 'Cố định theo HĐLĐ', tien: LUONG_CUNG },
    { ma: 'p1.1', ten: 'P1.1 Bảo toàn biên cước', soLieu: bienCuoc.dienGiai, tien: bienCuoc.tien },
    { ma: 'p1.2', ten: 'P1.2 Đảm bảo SLA giao hàng', soLieu: sla.dienGiai, tien: sla.tien },
    { ma: 'p1.3', ten: 'P1.3 Đơn giao hoàn hảo', soLieu: hoanHao.dienGiai, tien: hoanHao.tien },
    { ma: 'p1.4', ten: 'P1.4 Tuân thủ size thùng', soLieu: size.dienGiai, tien: size.tien },
    { ma: 'p2', ten: 'P2 Ship hộ', soLieu: shipHo.dienGiai, tien: shipHo.tien },
    { ma: 'p3.gate', ten: 'P3 Gate đối soát', soLieu: v.gateDat ? 'ĐẠT — được xét thưởng Pillar 3' : 'KHÔNG ĐẠT — mất toàn bộ Pillar 3', tien: 0 },
    { ma: 'p3b.1', ten: 'P3B Giảm rò rỉ dưới ngưỡng', soLieu: v.gateDat ? (v.roRiGiam ? 'Đạt' : 'Chưa đạt') : 'Không xét (trượt Gate)', tien: roRi },
    { ma: 'p3b.2', ten: 'P3B Khắc phục gốc lỗi "ta sai"', soLieu: v.gateDat ? (v.khacPhucGoc ? 'Đạt' : 'Chưa đạt') : 'Không xét (trượt Gate)', tien: khacPhuc },
    { ma: 'p3c', ten: 'P3C Thưởng thu hồi công nợ', soLieu: v.gateDat ? thuHoi.dienGiai : 'Không xét (trượt Gate)', tien: tien3C },
    { ma: 'clawback', ten: 'Clawback', soLieu: v.clawbackVnd > 0 ? 'Thu hồi thưởng kỳ trước' : 'Không có', tien: -Math.max(0, v.clawbackVnd) },
  ];
  const p1 = bienCuoc.tien + sla.tien + hoanHao.tien + size.tien;
  const p2 = shipHo.tien;
  const p3 = roRi + khacPhuc + tien3C;
  return { dong, p1, p2, p3, tong: dong.reduce((s, d) => s + d.tien, 0) };
}

/* ───────── BẢNG ĐIỂM KPI (không tiền) ─────────
 * CEO 10/09/2026: report cho nhân sự chỉ cần KẾT QUẢ KPI — đạt bao nhiêu phần trăm từng tiêu chí; quy ra tiền là việc
 * của HR. Các hàm tiền ở trên vẫn giữ để HR/kế toán đối chiếu khi cần, nhưng trang report không dùng.
 */

/** Trọng số Pillar 1 theo quy chế (mục III). */
export const TRONG_SO_P1 = { bienCuoc: 0.30, sla: 0.30, hoanHao: 0.30, sizeThung: 0.10 } as const;

export interface DongDiem {
  ma: string;
  ten: string;
  /** Trọng số trong Pillar 1; null với dòng không thuộc Pillar 1. */
  trongSo: number | null;
  /** Số đo thực tế trong kỳ. */
  soLieu: string;
  /** Ngưỡng quy chế để đối chiếu. */
  nguong: string;
  /** Mức đạt 0..1 (theo bậc quy chế); null = chưa có dữ liệu để chấm. */
  mucDat: number | null;
}

export interface BangDiemKpi {
  p1: DongDiem[];
  /** Điểm Pillar 1 = Σ(trọng số × mức đạt), 0..1. Tiêu chí chưa có dữ liệu tính 0. */
  diemP1: number;
  p2: DongDiem[];
  p3: DongDiem[];
  gateDat: boolean;
}

/** Bảng điểm KPI một kỳ — chỉ kết quả, không quy ra tiền. `ngayKy` (ISO, đầu kỳ) quyết định ngưỡng đạt của tiêu chí 1.2. */
export function bangDiemKpi(v: DauVaoKpi, ngayKy: string): BangDiemKpi {
  const bienCuoc = diemBienCuoc(v.soDonAmCuocLoi);
  const sla = diemSlaTheoKy(v.tyLeSla, ngayKy);
  const hoanHao = diemDonHoanHao(v.tyLeLoiChungTu);
  const size = diemSizeThung(v.tyLeSizeThung);
  const thuHoi = thuongThuHoi(v.thuHoiVnd, v.tyLeThuHoi);
  const tien = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

  const p1: DongDiem[] = [
    {
      ma: '1.1', ten: 'Bảo toàn biên cước', trongSo: TRONG_SO_P1.bienCuoc,
      soLieu: `${v.soDonAmCuocLoi} đơn âm cước do lỗi trách nhiệm`,
      nguong: '0 đơn — mỗi đơn trừ 10 % tiêu chí, trần trừ 50 %',
      mucDat: bienCuoc.mucNhan,
    },
    {
      ma: '1.2', ten: 'Đảm bảo SLA thời gian giao hàng', trongSo: TRONG_SO_P1.sla,
      soLieu: v.tyLeSla == null ? 'Chưa có kiện nào ghi nhận giao' : `${Math.round(v.tyLeSla * 1000) / 10}% kiện giao đúng cam kết từng nước`,
      nguong: `Ngưỡng kỳ ${Math.round(nguongDatKy(ngayKy) * 1000) / 10}% đủ · thiếu ≤5 điểm còn 75 % · thiếu ≤10 điểm còn 50 %`,
      mucDat: v.tyLeSla == null ? null : sla.mucNhan,
    },
    {
      ma: '1.3', ten: 'Đơn giao hoàn hảo', trongSo: TRONG_SO_P1.hoanHao,
      soLieu: v.tyLeLoiChungTu == null ? 'Chưa có hoá đơn trong kỳ' : `${Math.round(v.tyLeLoiChungTu * 1000) / 10}% kiện phát sinh phí do chứng từ/địa chỉ`,
      nguong: '≤2 % đủ · >2–5 % còn 70 % · >5 % mất',
      mucDat: v.tyLeLoiChungTu == null ? null : hoanHao.mucNhan,
    },
    {
      ma: '1.4', ten: 'Tuân thủ bảng tra size thùng', trongSo: TRONG_SO_P1.sizeThung,
      soLieu: v.tyLeSizeThung == null ? 'Chưa có kết quả audit Kho' : `${Math.round(v.tyLeSizeThung * 1000) / 10}% đơn đóng đúng size`,
      nguong: '≥98 % đủ · 95–98 % còn 50 % · <95 % mất',
      mucDat: v.tyLeSizeThung == null ? null : size.mucNhan,
    },
  ];
  const diemP1 = p1.reduce((s, d) => s + (d.trongSo ?? 0) * (d.mucDat ?? 0), 0);

  const p2: DongDiem[] = [{
    ma: '2', ten: 'Sản lượng ship hộ thành công', trongSo: null,
    soLieu: `${v.soDonShipHo} đơn`,
    nguong: `Mốc lũy tiến tại đơn thứ ${SHIP_HO_MOC}`,
    mucDat: null,
  }];

  const p3: DongDiem[] = [
    {
      ma: '3A', ten: 'Gate — đối chiếu & phân định đúng hạn', trongSo: null,
      soLieu: v.gateDat ? 'Đạt' : 'Chưa đạt',
      nguong: '100 % hoá đơn đối chiếu và 100 % đơn flag được phân định',
      mucDat: v.gateDat ? 1 : 0,
    },
    {
      ma: '3B-1', ten: 'Giảm rò rỉ dưới ngưỡng', trongSo: null,
      soLieu: v.gateDat ? (v.roRiGiam ? 'Đạt' : 'Chưa đạt') : 'Không xét (trượt Gate)',
      nguong: 'Tỉ lệ kg chênh không đòi được giảm so với baseline',
      mucDat: v.gateDat && v.roRiGiam ? 1 : 0,
    },
    {
      ma: '3B-2', ten: 'Khắc phục gốc lỗi "ta sai"', trongSo: null,
      soLieu: v.gateDat ? (v.khacPhucGoc ? 'Đạt' : 'Chưa đạt') : 'Không xét (trượt Gate)',
      nguong: '100 % lỗi nhóm "ta sai" được khắc phục, không tái diễn',
      mucDat: v.gateDat && v.khacPhucGoc ? 1 : 0,
    },
    {
      ma: '3C', ten: 'Thu hồi công nợ carrier', trongSo: null,
      soLieu: `Thu hồi ${tien(v.thuHoiVnd)}${v.tyLeThuHoi == null ? '' : ` · thực thu ${Math.round(v.tyLeThuHoi * 100)}% số thuộc diện khiếu nại (hệ số K ${heSoK(v.tyLeThuHoi).toFixed(1)})`}`,
      nguong: `Sàn nghĩa vụ ${tien(SAN_THU_HOI)}/tháng, vượt sàn mới tính thưởng`,
      mucDat: v.gateDat ? (thuHoi.tien > 0 ? 1 : 0) : 0,
    },
  ];

  return { p1, diemP1, p2, p3, gateDat: v.gateDat };
}

/* ───────── SLA 1.2 THEO SOP THẬT (thay phần mẫu trong văn bản) ─────────
 * CEO 10/09/2026: "SLA trên file chỉ là mẫu" → tiêu chí 1.2 chấm theo bảng SOP thật (D-067: cam kết từng nước, thước
 * riêng từng hãng), và BẬC CHẤM cũng phải đi theo lộ trình siết lỗi của SOP thay vì cố định 95/90/85 — nếu giữ bậc cũ
 * thì cam kết ngắn kiểu express sẽ luôn cho 0 điểm dù đội làm tốt.
 *
 * Ngưỡng đạt của kỳ = 100 % − tỉ lệ lỗi cho phép của kỳ (LO_TRINH_LOI). Bậc dưới nới thêm 5 và 10 điểm phần trăm.
 */
import { loiToiDaTaiNgay } from '@/features/shipments/sop-giao-hang';

export const NOI_BAC_75 = 0.05;
export const NOI_BAC_50 = 0.10;

/** Ngưỡng % đúng hạn phải đạt trong kỳ để tiêu chí 1.2 được tính đủ. */
export function nguongDatKy(ngayKy: string): number {
  return 1 - loiToiDaTaiNgay(ngayKy).loiToiDa;
}

/** 1.2 chấm theo ngưỡng của kỳ: đạt ngưỡng = đủ; thiếu ≤5 điểm = 75 %; thiếu ≤10 điểm = 50 %; thấp hơn = 0. */
export function diemSlaTheoKy(tyLeDat: number | null, ngayKy: string): MucDat {
  if (tyLeDat == null) return { tien: 0, mucNhan: 0, dienGiai: 'Chưa có kiện nào ghi nhận giao trong kỳ' };
  const nguong = nguongDatKy(ngayKy);
  const p = `${Math.round(tyLeDat * 1000) / 10} %`;
  const n = `${Math.round(nguong * 1000) / 10} %`;
  if (tyLeDat >= nguong) return { tien: QUY_P1.sla, mucNhan: 1, dienGiai: `${p} ≥ ngưỡng kỳ ${n}` };
  if (tyLeDat >= nguong - NOI_BAC_75) return { tien: QUY_P1.sla * 0.75, mucNhan: 0.75, dienGiai: `${p} — thiếu ≤5 điểm so với ngưỡng ${n}` };
  if (tyLeDat >= nguong - NOI_BAC_50) return { tien: QUY_P1.sla * 0.5, mucNhan: 0.5, dienGiai: `${p} — thiếu ≤10 điểm so với ngưỡng ${n}` };
  return { tien: 0, mucNhan: 0, dienGiai: `${p} — thấp hơn ngưỡng kỳ ${n} quá 10 điểm` };
}
