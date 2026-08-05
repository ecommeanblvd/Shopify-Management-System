import { describe, it, expect } from 'vitest';
import { contractStatus, validateContractFile, MAX_CONTRACT_BYTES } from './contract-status';

const NOW = new Date('2026-08-04T09:00:00Z');

describe('contractStatus', () => {
  it('còn hạn dài → active', () => {
    const r = contractStatus({ signedAt: '2026-01-01', expiresAt: '2027-01-01' }, NOW);
    expect(r.state).toBe('active');
    expect(r.daysLeft).toBe(150);
  });
  it('còn đúng 30 ngày → expiring_soon (biên ngưỡng)', () => {
    const r = contractStatus({ expiresAt: '2026-09-03' }, NOW);
    expect(r.state).toBe('expiring_soon');
    expect(r.daysLeft).toBe(30);
  });
  it('còn 31 ngày → vẫn active (ngoài ngưỡng)', () => {
    expect(contractStatus({ expiresAt: '2026-09-04' }, NOW).state).toBe('active');
  });
  it('hết hạn hôm nay → vẫn còn hiệu lực trong ngày (daysLeft 0)', () => {
    const r = contractStatus({ expiresAt: '2026-08-04' }, NOW);
    expect(r.state).toBe('expiring_soon');
    expect(r.daysLeft).toBe(0);
  });
  it('quá hạn → expired kèm số ngày đã quá', () => {
    const r = contractStatus({ expiresAt: '2026-07-25' }, NOW);
    expect(r.state).toBe('expired');
    expect(r.daysLeft).toBe(-10);
    expect(r.label).toContain('10 ngày trước');
  });
  it('không nhập ngày hết hạn → no_expiry', () => {
    expect(contractStatus({ signedAt: '2025-01-01' }, NOW).state).toBe('no_expiry');
    expect(contractStatus({}, NOW).state).toBe('no_expiry');
  });
  it('ký trước, hiệu lực sau → not_yet', () => {
    expect(contractStatus({ signedAt: '2026-09-01', expiresAt: '2027-09-01' }, NOW).state).toBe('not_yet');
  });
  it('ngày rác/sai định dạng → coi như không có', () => {
    expect(contractStatus({ expiresAt: '04/08/2026' }, NOW).state).toBe('no_expiry');
  });
});

describe('validateContractFile', () => {
  const f = (over: Partial<{ name: string; type: string; size: number }> = {}) =>
    ({ name: 'hop-dong.pdf', type: 'application/pdf', size: 1024, ...over });

  it('PDF hợp lệ → null', () => expect(validateContractFile(f())).toBeNull());
  it('Word docx hợp lệ', () => {
    expect(validateContractFile(f({ name: 'hd.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }))).toBeNull();
  });
  it('type rỗng nhưng đuôi .pdf → vẫn nhận (trình duyệt không đoán được type)', () => {
    expect(validateContractFile(f({ type: '' }))).toBeNull();
  });
  it('file rỗng → lỗi', () => expect(validateContractFile(f({ size: 0 }))).toContain('rỗng'));
  it('quá 25MB → lỗi kèm dung lượng', () => {
    const r = validateContractFile(f({ size: MAX_CONTRACT_BYTES + 1 }));
    expect(r).toContain('quá lớn');
  });
  it('định dạng lạ (.exe) → từ chối', () => {
    expect(validateContractFile(f({ name: 'x.exe', type: 'application/x-msdownload' }))).toContain('Chỉ nhận');
  });
});
