/**
 * Tách cells của một rate card theo `packageType`. FedEx có cả 'pak' (bậc thấp
 * 0.5–2.5kg) lẫn 'package' (hộp, mọi bậc) cho CÙNG (zone, tier) → phải tách để
 * hiển thị 2 bảng riêng trong Rate Workspace, tránh đè nhau. Thuần để test được.
 */
export interface RawMatrixCell {
  zoneId: string;
  tierId: string;
  costAmount: string | null;
  updatedAt: Date | null;
  packageType: 'pak' | 'package';
}

export interface MatrixCellLite {
  zoneId: string;
  tierId: string;
  costAmount: string | null;
  updatedAt: Date | null;
}

export interface SplitCells {
  /** Cells loại 'package' (hộp). */
  packageCells: MatrixCellLite[];
  /** Cells loại 'pak'. */
  pakCells: MatrixCellLite[];
  /** Tier id có ÍT NHẤT một cell 'pak' (để lọc ra bộ bậc PAK), giữ thứ tự gặp đầu. */
  pakTierIds: string[];
}

export function splitPackageCells(rows: RawMatrixCell[]): SplitCells {
  const packageCells: MatrixCellLite[] = [];
  const pakCells: MatrixCellLite[] = [];
  const pakTierIds: string[] = [];
  for (const r of rows) {
    const lite: MatrixCellLite = { zoneId: r.zoneId, tierId: r.tierId, costAmount: r.costAmount, updatedAt: r.updatedAt };
    if (r.packageType === 'pak') {
      pakCells.push(lite);
      if (!pakTierIds.includes(r.tierId)) pakTierIds.push(r.tierId);
    } else {
      packageCells.push(lite);
    }
  }
  return { packageCells, pakCells, pakTierIds };
}
