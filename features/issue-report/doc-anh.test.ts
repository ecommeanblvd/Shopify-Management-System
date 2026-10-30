import { describe, expect, it } from 'vitest';
import { laUuidBaoLoi } from './doc-anh';

describe('laUuidBaoLoi', () => {
  it('chặn id không phải UUID trước khi nó tới Postgres', () => {
    // Route ảnh đọc `reporter_id` TRƯỚC khi quyết quyền, nên một id rác đi thẳng vào
    // `eq(id, ...)` làm Postgres ném "invalid input syntax for type uuid" ⇒ 500 thay vì 404.
    for (const x of ['abc', '', '1', "' or 1=1--", 'ZZZZZZZZ-1111-2222-3333-444444444444']) {
      expect(laUuidBaoLoi(x), JSON.stringify(x)).toBe(false);
    }
  });

  it('nhận UUID thật', () => {
    expect(laUuidBaoLoi('5b674e6a-271f-4283-9eb7-ee814b302863')).toBe(true);
  });
});
