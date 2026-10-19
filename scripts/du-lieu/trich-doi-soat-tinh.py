# -*- coding: utf-8 -*-
"""Trích dữ liệu BRAND ĐỌC ĐƯỢC từ doi-soat-tinh-atelier.xlsx ra JSON cho script đẩy sheet.

Vì sao có bước này: file Excel là bản đã soát và CEO đã chốt (19/10/2026), nên nó — không phải
Lark — là nguồn cho lượt đẩy. Nhưng file Excel chứa CỘT NỘI BỘ không được để brand thấy:
"Giá vốn (INS)", "Lãi thuần (INS)", và các cột soát ("Có trong file Đức?", "Lệch", ...). Bước
trích này CẮT những cột đó ra, nên dữ liệu đi lên sheet brand không bao giờ mang theo giá vốn.
"""
import json, re, openpyxl

MA_DON = re.compile(r'^\d{2}-INSLG-SV-\d{4}$')

NGUON = 'doi-soat-tinh-atelier.xlsx'
RA = 'scripts/du-lieu/doi-soat-lich-su-tinh.json'

# NGÀY CHUẨN lấy từ bảng Lark qua `lay-ngay-lark-tinh.ts`.
#
# Vì sao không dùng ngày trong file Excel: ô ngày của Lark là epoch, và mọi dòng TINH kỳ cũ có
# epoch đúng 17:00:00Z — nửa đêm GIỜ VIỆT NAM, tức ô ngày-trần theo giờ VN. Bản trích Excel đầu
# tiên quy về UTC nên lùi một ngày ở MỌI dòng (0018 ra 16/07 trong khi ô chọn 17/07). Cả ba
# nguồn đối chiếu đều xác nhận: sheet WholeSale ghi 0411 là "28/01/2026", 0286 là "17/11/2025",
# khớp Lark chứ không khớp bản trích cũ.
NGAY_LARK = 'scripts/du-lieu/ngay-lark-tinh.json'


def so(v):
    if v is None or v == '':
        return 0
    return float(v)


def chu(v):
    return '' if v is None else str(v).strip()


def ngay_iso(v):
    s = chu(v)
    if not s:
        return None
    if len(s) >= 10 and s[4] == '-' and s[7] == '-':
        return s[:10]
    if '/' in s:
        d, m, y = s.split('/')[:3]
        return f'{y}-{int(m):02d}-{int(d):02d}'
    return None


def main():
    with open(NGAY_LARK, encoding='utf-8') as f:
        ngay_lark = json.load(f)
    doi_ngay = []

    def ngay_chuan(ma, tu_file):
        """Ngày Lark nếu có; ghi lại mọi chỗ lệch để nhìn thấy chứ không sửa lặng."""
        lark = ngay_lark.get(ma)
        if lark is None:
            return tu_file
        if lark != tu_file:
            doi_ngay.append((ma, tu_file, lark))
        return lark

    wb = openpyxl.load_workbook(NGUON, data_only=True)

    ws = wb['Chi tiết 26 đơn']
    hang = [list(r) for r in ws.iter_rows(min_row=5, max_row=ws.max_row, values_only=True)]
    ban_le = []
    for r in hang:
        ma = chu(r[0])
        if not MA_DON.match(ma):
            continue
        if chu(r[1]) != 'Bán lẻ' or chu(r[3]) != 'Trong kỳ':
            continue
        ban_le.append({
            'ma': ma, 'ky': chu(r[2]), 'ngay': ngay_chuan(ma, ngay_iso(r[4])), 'tracking': chu(r[5]),
            'hang': chu(r[6]), 'nuoc': chu(r[7]), 'nhan': chu(r[8]),
            'canKhai': so(r[9]), 'canTinh': so(r[10]), 'dim': chu(r[11]),
            'giao': chu(r[12]), 'cuoc': so(r[13]), 'pctFuel': so(r[14]), 'fuel': so(r[15]),
            'vungXa': so(r[16]), 'xlhh': so(r[17]), 'kyNhan': so(r[18]),
            'vatKhac': so(r[19]), 'tongThu': so(r[20]),
        })

    ws = wb['WholeSale TINH']
    hang = [list(r) for r in ws.iter_rows(min_row=6, max_row=ws.max_row, values_only=True)]
    ws_ra = []
    for r in hang:
        ma = chu(r[0])
        if not MA_DON.match(ma):
            continue
        ws_ra.append({
            'ma': ma, 'ngay': ngay_chuan(ma, ngay_iso(r[1])), 'line': chu(r[2]),
            'tracking': chu(r[3]), 'ref': chu(r[4]), 'loaiHinh': chu(r[6]),
            'phapNhan': chu(r[7]), 'aiTra': chu(r[8]), 'nhan': chu(r[9]), 'nuoc': chu(r[10]),
            'kl': so(r[11]), 'kien': chu(r[12]), 'toKhai': so(r[13]), 'uyQuyen': so(r[14]),
            'stationary': so(r[15]), 'cuoc': so(r[16]), 'pctFuel': so(r[17]), 'fuel': so(r[18]),
            'vatKhac': so(r[19]), 'daTra': so(r[20]), 'canThu': so(r[21]), 'ghiChu': chu(r[22]),
        })

    ws_ra.sort(key=lambda x: (x['ngay'] or '', x['ma']))
    ban_le.sort(key=lambda x: (x['ngay'] or '', x['ma']))

    ra = {
        'nguon': NGUON,
        'chot': '2026-10-19',
        'banLe': ban_le,
        'wholeSale': ws_ra,
    }
    with open(RA, 'w', encoding='utf-8') as f:
        json.dump(ra, f, ensure_ascii=False, indent=1)
    print(f'{RA}: {len(ban_le)} đơn bán lẻ · {len(ws_ra)} đơn WholeSale')
    if doi_ngay:
        print(f'  ngày sửa theo Lark ({len(doi_ngay)} dòng):')
        for ma, cu, moi in doi_ngay:
            print(f'    {ma}  {cu} → {moi}')
    thieu_ngay = [x['ma'] for x in ban_le + ws_ra if x['ngay'] is None]
    if thieu_ngay:
        raise SystemExit(f'DỪNG: thiếu ngày ở {thieu_ngay}')
    print('  tổng thu bán lẻ   ', f"{sum(x['tongThu'] for x in ban_le):,.2f}")
    print('  tổng cần thu WS   ', f"{sum(x['canThu'] for x in ws_ra):,.2f}")
    for x in ban_le:
        if x['ngay'] is None:
            print('  ⚠ thiếu ngày:', x['ma'])
    for x in ws_ra:
        if x['ngay'] is None:
            print('  ⚠ thiếu ngày:', x['ma'])


main()
