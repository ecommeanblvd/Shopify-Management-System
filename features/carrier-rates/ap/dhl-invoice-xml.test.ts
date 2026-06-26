import { describe, it, expect } from 'vitest';
import { parseDhlInvoiceXml } from './dhl-invoice-xml';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice><ID>HANRTEST001</ID>
<LegalTotal><LineExtensionTotalAmount amountCurrencyID="VND">2404330.00</LineExtensionTotalAmount><TaxExclusiveTotalAmount>2404330.00</TaxExclusiveTotalAmount><TaxInclusiveTotalAmount>2596677.00</TaxInclusiveTotalAmount></LegalTotal>
<TaxTotal><TotalTaxAmount>192347.00</TotalTaxAmount></TaxTotal>
<IssueDate>2026-03-31</IssueDate>
<PaymentMeans><PaymentDueDate>2026-04-14</PaymentDueDate></PaymentMeans>
<InvoiceLine><Item><Delivery><ActualDeliveryDateTime>2026-03-10</ActualDeliveryDateTime></Delivery><BuyersItemIdentification><ID>P</ID><code>P</code></BuyersItemIdentification><Description>EXPRESS WORLDWIDE nondoc</Description></Item><LineExtensionAmount>803632.00</LineExtensionAmount><TotalTaxAmount>64291.00</TotalTaxAmount><Delivery><OrderLineReference><OrderReference></OrderReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference><LoadWeight>1.45</LoadWeight></Delivery></InvoiceLine>
<InvoiceLine><Item><BuyersItemIdentification><ID>FF</ID><code>FF</code></BuyersItemIdentification></Item><LineExtensionAmount>525098.00</LineExtensionAmount><TotalTaxAmount>42008.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference></Delivery></InvoiceLine>
<InvoiceLine><Item><BuyersItemIdentification><ID>CA</ID><code>CA</code></BuyersItemIdentification></Item><LineExtensionAmount>918000.00</LineExtensionAmount><TotalTaxAmount>73440.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference></Delivery></InvoiceLine>
<InvoiceLine><Item><BuyersItemIdentification><ID>SF</ID><code>SF</code></BuyersItemIdentification></Item><LineExtensionAmount>150000.00</LineExtensionAmount><TotalTaxAmount>12000.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference></Delivery></InvoiceLine>
<InvoiceLine><Item><BuyersItemIdentification><ID>FD</ID><code>FD</code></BuyersItemIdentification></Item><LineExtensionAmount>7600.00</LineExtensionAmount><TotalTaxAmount>608.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>3483557033</SellersLineId><BuyersLineId>#MBLVD27669</BuyersLineId></OrderLineReference></Delivery></InvoiceLine>
<InvoiceLine><Item><Delivery><ActualDeliveryDateTime>2026-03-12</ActualDeliveryDateTime></Delivery><BuyersItemIdentification><ID>P</ID><code>P</code></BuyersItemIdentification><Description>EXPRESS WORLDWIDE nondoc</Description></Item><LineExtensionAmount>500000.00</LineExtensionAmount><TotalTaxAmount>40000.00</TotalTaxAmount><Delivery><OrderLineReference><SellersLineId>9999999999</SellersLineId><BuyersLineId>#TA2200</BuyersLineId></OrderLineReference><LoadWeight>2.00</LoadWeight></Delivery></InvoiceLine>
</Invoice>`;

describe('parseDhlInvoiceXml', () => {
  it('Invoice-level fields', () => {
    const p = parseDhlInvoiceXml(XML)!;
    expect(p.billNumber).toBe('HANRTEST001');
    expect(p.amountInclVat).toBe(2596677);
    expect(p.amountExclVat).toBe(2404330);
    expect(p.issueDate).toBe('2026-03-31');
    expect(p.dueDate).toBe('2026-04-14');
    expect(p.currency).toBe('VND');
  });
  it('group theo SellersLineId → 2 shipment, đủ phí, total đúng', () => {
    const p = parseDhlInvoiceXml(XML)!;
    expect(p.shipments).toHaveLength(2);
    const s = p.shipments.find((x) => x.shipmentNumber === '3483557033')!;
    expect(s.orderRef).toBe('#MBLVD27669');
    expect(s.weightKg).toBe(1.45);
    expect(s.date).toBe('2026-03-10');
    expect(s.charges).toHaveLength(5); // P/FF/CA/SF/FD
    expect(s.charges.map((c) => c.code).sort()).toEqual(['CA','FD','FF','P','SF']);
    expect(s.totalExclVat).toBe(2404330);
    expect(s.totalTax).toBe(192347);
    expect(s.totalInclVat).toBe(2596677);
  });
  it('XML rỗng/sai → null', () => {
    expect(parseDhlInvoiceXml('')).toBeNull();
    expect(parseDhlInvoiceXml('<x/>')).toBeNull();
  });
});
