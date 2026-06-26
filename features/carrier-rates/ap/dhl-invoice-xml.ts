/**
 * Parser hoá đơn DHL dạng XML (AccountisXML Global Invoice). Đọc THẲNG file gốc
 * của DHL — đủ + đúng mọi loại phí để đối soát. Xuất cùng DhlInvoicePrefill như
 * CSV parser → downstream (bill-line, reconcile) không đổi. Hand-rolled (không lib).
 */
import type { DhlInvoicePrefill, DhlShipment, DhlChargeLine } from './dhl-invoice-csv';

/** Tên đọc-được cho mã phí DHL (XML để name rỗng). bucketOf phân loại theo code. */
const DHL_CHARGE_CODE_NAME: Record<string, string> = {
  P: 'Weight charge', FF: 'Fuel Surcharge', FD: 'GoGreen Plus - Carbon Reduced',
  CA: 'Elevated Risk', SF: 'Direct Signature', MA: 'Address Correction',
  YL: 'Non-Conveyable Piece', YO: 'Non-Conveyable Piece',
};

/** Lấy text của tag đầu tiên trong 1 đoạn. THUẦN. */
function tagText(block: string, name: string): string {
  const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : '';
}
function num(s: string): number { const n = Number((s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0; }
function r2(n: number): number { return Math.round(n * 100) / 100; }

export function parseDhlInvoiceXml(text: string): DhlInvoicePrefill | null {
  if (!text || !/<Invoice\b/.test(text)) return null;
  const firstLine = text.indexOf('<InvoiceLine');
  const header = firstLine >= 0 ? text.slice(0, firstLine) : text;
  const billNumber = tagText(header, 'ID');
  const issueDate = tagText(header, 'IssueDate');
  if (!billNumber || !issueDate) return null;
  const amountInclVat = num(tagText(header, 'TaxInclusiveTotalAmount'));
  const amountExclVat = num(tagText(header, 'TaxExclusiveTotalAmount'));
  const dueDate = tagText(header, 'PaymentDueDate') || issueDate;
  const curMatch = header.match(/amountCurrencyID="([^"]+)"/);
  const currency = curMatch?.[1] ?? 'VND';

  // Gom InvoiceLine theo SellersLineId.
  const byTracking = new Map<string, DhlShipment>();
  const lineBlocks = text.split('<InvoiceLine').slice(1).map((b) => '<InvoiceLine' + b.split('</InvoiceLine>')[0] + '</InvoiceLine>');
  for (const block of lineBlocks) {
    const tracking = tagText(block, 'SellersLineId');
    if (!tracking) continue;
    const idBlock = block.match(/<BuyersItemIdentification>([\s\S]*?)<\/BuyersItemIdentification>/);
    const code = idBlock ? (tagText(idBlock[1], 'code') || tagText(idBlock[1], 'ID')) : '';
    const charge = num(tagText(block, 'LineExtensionAmount'));
    const tax = num(tagText(block, 'TotalTaxAmount'));
    const c: DhlChargeLine = { code, name: DHL_CHARGE_CODE_NAME[code] ?? code, charge, tax, total: r2(charge + tax) };

    let sh = byTracking.get(tracking);
    if (!sh) {
      sh = {
        shipmentNumber: tracking,
        orderRef: tagText(block, 'BuyersLineId'),
        date: tagText(block, 'ActualDeliveryDateTime') || issueDate,
        product: tagText(block, 'Description'),
        weightKg: num(tagText(block, 'LoadWeight')) || num(tagText(block, 'TenderWeight')),
        charges: [], totalExclVat: 0, totalTax: 0, totalInclVat: 0,
      };
      byTracking.set(tracking, sh);
    }
    // Bổ sung field còn thiếu từ dòng có dữ liệu (vd dòng P mang weight/date/desc).
    if (!sh.orderRef) sh.orderRef = tagText(block, 'BuyersLineId');
    if (!sh.weightKg) sh.weightKg = num(tagText(block, 'LoadWeight')) || num(tagText(block, 'TenderWeight'));
    if (!sh.product) sh.product = tagText(block, 'Description');
    sh.charges.push(c);
    sh.totalExclVat = r2(sh.totalExclVat + charge);
    sh.totalTax = r2(sh.totalTax + tax);
    sh.totalInclVat = r2(sh.totalInclVat + charge + tax);
  }

  const shipments = [...byTracking.values()];
  const shipDates = shipments.map((s) => s.date).filter(Boolean).sort();
  const refs = [...new Set(shipments.map((s) => s.orderRef).filter(Boolean))];
  return {
    billNumber, currency, amountInclVat, amountExclVat, issueDate, dueDate,
    periodStart: shipDates[0] ?? issueDate,
    periodEnd: shipDates[shipDates.length - 1] ?? issueDate,
    note: refs.join(', '),
    shipmentCount: shipments.length,
    shipments,
  };
}
