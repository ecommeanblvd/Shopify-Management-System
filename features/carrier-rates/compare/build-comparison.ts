/**
 * Bảng so sánh cước carrier — hàm THUẦN (không I/O). Fan-out engine `quote()`
 * cho từng (nước × cân × carrier) tại một `effectiveDate`, quy mọi total về VND,
 * xếp rẻ→đắt và đánh dấu carrier rẻ nhất kèm % chênh. Caller (server action) lo
 * load snapshot + top nước rồi truyền vào.
 */
import { quote, type CarrierAccountSnapshot } from '../engine/quote';

/** Tỷ giá USD→VND fallback khi account không quote ở VND (không account nào
 *  hiện dùng nhánh này — cả ba đều VND ở cost hoặc display). */
const USD_TO_VND_FALLBACK = 26_000;

export interface CarrierRate {
  accountId: string;
  carrierName: string;
  /** All-in (base + fuel + VAT), đã quy về VND. Cước ta TRẢ carrier (chưa markup). */
  vnd: number;
  /** Rẻ nhất trong ô. */
  cheapest: boolean;
  /** 0 với rẻ nhất; +% đắt hơn rẻ nhất với phần còn lại (làm tròn 0 dp). */
  pctOverCheapest: number;
}

export interface ComparisonCell {
  /** Rẻ → đắt. Rỗng khi không carrier nào phủ nước ở cân đó. */
  rates: CarrierRate[];
}

export interface ComparisonCube {
  countries: string[];
  weights: number[];
  /** cells[countryCode][weightKg] = ComparisonCell. */
  cells: Record<string, Record<number, ComparisonCell>>;
}

export interface CompareCountryMeta {
  code: string;   // ISO-2 upper
  name: string;   // tên nước hiển thị
  orders: number; // số đơn Shopify trong cửa sổ
}

/**
 * Quy `carrierCost` của một account về VND để so sánh chéo:
 *  - cost=VND (DHL/FedEx VN) → carrierCost đã là VND.
 *  - display=VND (Aramex: cost USD, display VND) → carrierCostDisplay.
 *  - không bên nào VND → carrierCost × tỷ giá fallback.
 */
export function carrierCostToVnd(
  snap: Pick<CarrierAccountSnapshot, 'costCurrency' | 'displayCurrency'>,
  breakdown: { carrierCost: number; carrierCostDisplay: number },
): number {
  if (snap.costCurrency === 'VND') return breakdown.carrierCost;
  if (snap.displayCurrency === 'VND') return breakdown.carrierCostDisplay;
  return breakdown.carrierCost * USD_TO_VND_FALLBACK;
}

export function buildComparison(
  snaps: CarrierAccountSnapshot[],
  countries: string[],
  weights: number[],
  effectiveDate: Date,
): ComparisonCube {
  const cells: Record<string, Record<number, ComparisonCell>> = {};
  for (const country of countries) {
    cells[country] = {};
    for (const weightKg of weights) {
      const rates: CarrierRate[] = [];
      for (const snap of snaps) {
        const res = quote(snap, {
          destinationCountry: country,
          weightKg,
          packagingType: 'bag',
          effectiveDate,
        });
        if (!res.ok) continue;
        rates.push({
          accountId: snap.id,
          carrierName: snap.name,
          vnd: carrierCostToVnd(snap, res.breakdown),
          cheapest: false,
          pctOverCheapest: 0,
        });
      }
      rates.sort((x, y) => x.vnd - y.vnd);
      const min = rates[0]?.vnd;
      for (const r of rates) {
        if (min && min > 0) {
          r.cheapest = r.vnd === min;
          r.pctOverCheapest = r.vnd === min ? 0 : Math.round((r.vnd / min - 1) * 100);
        } else {
          r.cheapest = r.vnd === min;
        }
      }
      cells[country][weightKg] = { rates };
    }
  }
  return { countries: [...countries], weights: [...weights], cells };
}
