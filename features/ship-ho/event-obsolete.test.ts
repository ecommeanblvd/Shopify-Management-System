import { describe, it, expect } from 'vitest';
import { lyDoBoQua } from './event-obsolete';

const d = (s: string) => new Date(s);

describe('lyDoBoQua — chặn gửi lại dữ liệu đã cũ', () => {
  it('chưa có gì gửi sau nó → vẫn gửi', () => {
    expect(lyDoBoQua({ event: 'order.reconciled', occurredAt: d('2026-08-20') }, [])).toBeNull();
  });

  it('cùng loại đã gửi bản MỚI hơn → bỏ (ca SV-0009 kẹt 20/07, bản 27/07 đã gửi)', () => {
    const r = lyDoBoQua(
      { event: 'order.reconciled', occurredAt: d('2026-07-20') },
      [{ event: 'order.reconciled', occurredAt: d('2026-07-27') }],
    );
    expect(r).toContain('mới hơn');
  });

  it('cùng loại nhưng gửi TRƯỚC nó → vẫn gửi', () => {
    expect(lyDoBoQua(
      { event: 'order.reconciled', occurredAt: d('2026-08-20') },
      [{ event: 'order.reconciled', occurredAt: d('2026-07-27') }],
    )).toBeNull();
  });

  it('reconcile_pending mà sau đó đã chốt giá → bỏ, tránh báo lùi trạng thái', () => {
    const r = lyDoBoQua(
      { event: 'order.reconcile_pending', occurredAt: d('2026-08-10') },
      [{ event: 'order.reconciled', occurredAt: d('2026-08-20') }],
    );
    expect(r).toContain('đã chốt giá');
  });

  it('reconcile_pending mà chưa chốt giá → vẫn gửi', () => {
    expect(lyDoBoQua(
      { event: 'order.reconcile_pending', occurredAt: d('2026-08-10') },
      [{ event: 'shipment.delivered', occurredAt: d('2026-08-12') }],
    )).toBeNull();
  });

  it('order.received đã gửi bản mới hơn → bỏ (ca SV-0014 http 409)', () => {
    expect(lyDoBoQua(
      { event: 'order.received', occurredAt: d('2026-07-20') },
      [{ event: 'order.received', occurredAt: d('2026-07-21') }],
    )).toContain('mới hơn');
  });

  it('loại khác gửi sau KHÔNG làm nó cũ đi', () => {
    expect(lyDoBoQua(
      { event: 'order.reconciled', occurredAt: d('2026-08-20') },
      [{ event: 'shipment.delivered', occurredAt: d('2026-08-25') }],
    )).toBeNull();
  });
});
