/** THUẦN: gộp doanh thu (tiền đơn) + COGS theo kỳ (VND) + tỉ giá tháng → dòng báo cáo lãi gộp, VND (spec §6). */
import { doiTienTheoThang, type TiGiaThang } from './tien';

export interface DoanhThuThang { period: string; storeId: string; currency: string; doanhThuThuan: number; phiShip: number; soDon: number; soLine: number; soLineCoCogs: number; doanhThuLineCoCogs: number; doanhThuLineTong: number }
export interface CogsThang { period: string; storeId: string | null; brandSlug: string | null; amount: number; currency: string; thuocThangTruoc: number }
export interface OfflineThang { period: string; brandSlug: string; amount: number }
export interface DongBaoCao { period: string; doanhThuThuan: number; phiShip: number; cogs: number; laiGop: number; offline: number; phuLine: number; phuDoanhThu: number; thuocThangTruoc: number; tiGiaTam: boolean; thieuTiGia: boolean }

const VND = 'VND';
export function tinhBaoCao(input: { thang: string[]; doanhThu: DoanhThuThang[]; cogs: CogsThang[]; offline: OfflineThang[]; rates: TiGiaThang[] }): DongBaoCao[] {
  return input.thang.map((period) => {
    let doanhThuThuan = 0, phiShip = 0, soLine = 0, soLineCoCogs = 0, dtGoc = 0, dtCoCogs = 0, tiGiaTam = false, thieuTiGia = false;
    for (const d of input.doanhThu.filter((x) => x.period === period)) {
      const a = doiTienTheoThang(d.doanhThuThuan, d.currency, VND, period, input.rates);
      const b = doiTienTheoThang(d.phiShip, d.currency, VND, period, input.rates);
      if (!a || !b) { thieuTiGia = true; } else { doanhThuThuan += a.amount; phiShip += b.amount; tiGiaTam ||= a.tam; }
      // dtGoc/dtCoCogs (mẫu số/tử số của phuDoanhThu) đều lấy CÙNG cơ sở LINE
      // (doanhThuLineTong / doanhThuLineCoCogs) — không dùng doanhThuThuan (mức
      // đơn, có gồm shipping) làm mẫu số vì hai đại lượng khác cơ sở, tỉ lệ ra
      // sai lệch không phản ánh đúng độ phủ COGS theo line.
      soLine += d.soLine; soLineCoCogs += d.soLineCoCogs; dtGoc += d.doanhThuLineTong; dtCoCogs += d.doanhThuLineCoCogs;
    }
    let cogs = 0, thuocThangTruoc = 0;
    for (const c of input.cogs.filter((x) => x.period === period)) {
      const v = doiTienTheoThang(c.amount, c.currency, VND, period, input.rates);
      if (!v) { thieuTiGia = true; continue; }
      cogs += v.amount; thuocThangTruoc += c.thuocThangTruoc; tiGiaTam ||= v.tam;
    }
    const offline = input.offline.filter((x) => x.period === period).reduce((s, x) => s + x.amount, 0);
    return {
      period, doanhThuThuan, phiShip, cogs, laiGop: doanhThuThuan - phiShip - cogs, offline,
      phuLine: soLine ? soLineCoCogs / soLine : 0, phuDoanhThu: dtGoc ? dtCoCogs / dtGoc : 0,
      thuocThangTruoc, tiGiaTam, thieuTiGia,
    };
  });
}
