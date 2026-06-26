import { describe, it, expect } from 'vitest';
import { parseAramexHn, aramexHnCells } from './aramex-hn-rates';

// Slice -layout: header nhóm 1 + 2 dòng cân, header nhóm 2 + 2 dòng cân.
const TEXT = [
  'COUNTRY     BAHRAIN     BANGLADESH     EGYPT     JORDAN    KUWAIT     SOUTH AFRICA    QATAR    SAUDI ARABIA    UNITED ARAB EMIRATES    SWITZERLAND',
  ' Weight         1             2           3         4         5           6          7            8              9          10',
  '   0,50       18,31        18,34        19,72     20,17    18,48        22,08      20,09        18,64          18,34       25,35',
  '   1,00       27,61        28,02        30,41     30,41    25,54        32,61      28,31        26,64          24,08       35,11',
  '  21-44       Call         Call         Call      Call     Call         Call       Call         Call           Call        Call',
  'COUNTRY     OMAN     UNITED STATES     SINGAPORE     JAPAN    CHINA    HONG KONG    TAIWAN    THAILAND    INDIA    INDONESIA',
  ' Weight        11            12            13        14       15         16         17          18         19         20',
  '   0,50       12,17        18,14         6,83      17,85    12,01      12,98      10,91         8,13       13,4       23,49',
  '   1,00       18,26        26,08         8,48      19,72    13,43      15,33      13,72        11,33       21,37      26,81',
].join('\n');

describe('parseAramexHn', () => {
  it('parse đúng giá theo (nước, cân)', () => {
    const parsed = parseAramexHn(TEXT);
    const get = (zone: string, weightKg: number) =>
      parsed.light.find((r) => r.zone === zone && r.weightKg === weightKg)?.rate;
    expect(get('Bahrain', 0.5)).toBe(18.31);
    expect(get('Switzerland', 1.0)).toBe(35.11);
    expect(get('Japan', 0.5)).toBe(17.85);
    expect(get('Indonesia', 1.0)).toBe(26.81);
    expect(parsed.light.every((r) => r.packageType === 'package')).toBe(true);
    expect(parsed.heavy).toEqual([]);
  });
  it('2 dòng cân × 2 nhóm × 10 nước = 40 light rate (bỏ dòng "Call")', () => {
    expect(parseAramexHn(TEXT).light).toHaveLength(40);
  });
});

describe('aramexHnCells', () => {
  it('cells dùng zoneLabel = tên nước (không prefix "Zone")', () => {
    const cells = aramexHnCells(TEXT);
    const c = cells.find((x) => x.zoneLabel === 'Bahrain' && x.upperKg === 0.5);
    expect(c).toMatchObject({ zoneLabel: 'Bahrain', upperKg: 0.5, packageType: 'package', cost: 18.31 });
    expect(cells).toHaveLength(40);
  });
});
