# -*- coding: utf-8 -*-
"""Dựng file đối soát Mirer từ nguồn Lark đã trích — 4 sheet, cùng khuôn file TINH.

Nguồn (chạy hai script này trước):
  scripts/du-lieu/trich-wholesale-lark.ts   → wholesale-lark.json    (sheet WholeSale, cả 2 brand)
  scripts/du-lieu/trich-ship-ho-lark.ts     → ship-ho-lark-mirer.json (bảng ship hộ + đối chiếu SMS)

Mirer khác TINH về bản chất: KHÔNG có đơn bán lẻ kỳ cũ nào. 0463/0467 chính là đơn WholeSale
(nằm ở cả hai bảng, số khớp nhau), 0627 đã lên bảng kê 9.26 của hệ thống, còn 0572 chưa từng
được định giá. Nên file không có tab "Bán lẻ" như TINH.

  python3 scripts/du-lieu/dung-file-doi-soat-mirer.py
"""
import json
import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

RA = 'doi-soat-mirer-wholesale.xlsx'
FONT = 'Arial'
CHOT = '19/10/2026'

DAM = PatternFill('solid', fgColor='1F3864')
VANG = PatternFill('solid', fgColor='FFF2CC')
DO = PatternFill('solid', fgColor='FCE4E4')
XANH = PatternFill('solid', fgColor='E2EFDA')
TIEN = '#,##0" đ"'
KE_TREN = Border(top=Side(style='medium'))


def tieu_de(sh, hang, cot_ten):
    for i, t in enumerate(cot_ten, 1):
        o = sh.cell(hang, i, t)
        o.font = Font(name=FONT, size=10, bold=True, color='FFFFFF')
        o.fill = DAM
        o.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    sh.freeze_panes = sh.cell(hang + 1, 3)


def no(sh, hang, cot, gia_tri, *, tien=False, pct=False, fill=None, dam=False, wrap=False):
    o = sh.cell(hang, cot, gia_tri)
    o.font = Font(name=FONT, size=10, bold=dam)
    if tien:
        o.number_format = TIEN
    if pct:
        o.number_format = '0.00%'
    if fill:
        o.fill = fill
    o.alignment = Alignment(vertical='top', wrap_text=wrap)
    return o


def rong_cot(sh, rong):
    for i, w in enumerate(rong, 1):
        sh.column_dimensions[get_column_letter(i)].width = w


def ky(ngay):
    return f'{int(ngay[5:7])}/{ngay[:4]}'


COT_WS = [
    'STT', 'Mã đơn', 'Ngày', 'Kỳ', 'Line ship', 'Tracking', 'Reference', 'Loại hình',
    'Pháp nhân', 'Bên trả cước', 'Người nhận', 'Nước', 'KL (kg)', 'Số kiện | Dim',
    'Phí xử lý tờ khai', 'Phí uỷ quyền', 'Stationary', 'Cước', '% PP nhiên liệu',
    'PP nhiên liệu', 'VAT | Phí khác', 'Đã thanh toán', 'TỔNG CẦN THU', 'Ghi chú',
    'Nguồn ngày', 'ĐÃ THU TIỀN?',
]
TIEN_WS = [15, 16, 17, 18, 20, 21, 22, 23]


def sheet_wholesale(wb, don):
    sh = wb.create_sheet('WholeSale Mirer')
    no(sh, 1, 1, 'ĐƠN WHOLESALE — MIRER', dam=True)
    no(sh, 2, 1, f'Nguồn: Lark wiki QUzLwtUfXiSVK1k1mHXli4C6gPc · sheet "Tổng hợp đơn WholeSale" (WihWN3), chốt {CHOT}.')
    no(sh, 3, 1, 'Cột "Bên trả cước": "Người gửi" = bên mình trả cước → thu lại cả cước. "Người nhận" trả → bên mình chỉ thu phí xử lý tờ khai.')
    tieu_de(sh, 5, COT_WS)
    h0 = 6
    for i, d in enumerate(don):
        r = h0 + i
        la_suy_luan = d.get('suyLuanNgay')
        fill = DO if la_suy_luan else None
        no(sh, r, 1, i + 1)
        no(sh, r, 2, d['ma'])
        no(sh, r, 3, d['ngay'], fill=fill)
        no(sh, r, 4, ky(d['ngay']), fill=fill)
        no(sh, r, 5, d['lineShip'])
        no(sh, r, 6, d['tracking'])
        no(sh, r, 7, d['ref'])
        no(sh, r, 8, d['loaiHinh'])
        no(sh, r, 9, d['phapNhan'])
        no(sh, r, 10, d['aiTra'], fill=VANG if d['aiTra'] == 'Người gửi' else None)
        no(sh, r, 11, d['nhan'])
        no(sh, r, 12, d['nuoc'])
        no(sh, r, 13, d['kl'])
        no(sh, r, 14, d['kien'])
        for c, k in zip((15, 16, 17, 18), ('toKhai', 'uyQuyen', 'stationary', 'cuoc')):
            no(sh, r, c, d[k], tien=True)
        no(sh, r, 19, d['pctFuel'], pct=True)
        for c, k in zip((20, 21, 22), ('fuel', 'vatKhac', 'daTra')):
            no(sh, r, c, d[k], tien=True)
        # TỔNG CẦN THU là CÔNG THỨC, không phải số chép từ sheet nguồn: sửa một khoản thì tổng đổi theo.
        no(sh, r, 23, f'=SUM(O{r}:R{r})+T{r}+U{r}+V{r}', tien=True, dam=True)
        no(sh, r, 24, d['ghiChu'], wrap=True)
        no(sh, r, 25, ('⚠ SUY LUẬN — ' if la_suy_luan else '') + d['nguonNgay'], fill=fill, wrap=True)
        no(sh, r, 26, 'CHƯA THU', fill=VANG)
    rt = h0 + len(don)
    no(sh, rt, 2, f'TỔNG {len(don)} ĐƠN', dam=True)
    for c in TIEN_WS:
        L = get_column_letter(c)
        no(sh, rt, c, f'=SUM({L}{h0}:{L}{rt - 1})', tien=True, dam=True)
    for c in range(1, len(COT_WS) + 1):
        sh.cell(rt, c).fill = VANG
        sh.cell(rt, c).border = KE_TREN
    rong_cot(sh, [5, 19, 11, 9, 12, 16, 20, 11, 11, 13, 26, 14, 8, 17,
                  15, 13, 12, 14, 12, 14, 14, 15, 16, 24, 34, 12])
    return rt


COT_SH = [
    'STT', 'Mã đơn', 'Ngày', 'Hãng', 'Tracking', 'Nước', 'Người nhận', 'Cân (kg)',
    'Trạng thái giao', 'Cước tính (Lark)', 'Tổng thu (Lark)', 'Giá vốn (INS)',
    'Lãi thuần (thu SMS nếu có)',
    'Là đơn WholeSale?', 'Trong SMS?', 'Mã SMS', 'Thu theo SMS', 'ĐÁNH GIÁ',
]


def sheet_ship_ho(wb, don, ma_ws):
    sh = wb.create_sheet('Chi tiết ship hộ Lark')
    no(sh, 1, 1, 'CHI TIẾT BẢNG SHIP HỘ LARK — MIRER', dam=True)
    no(sh, 2, 1, f'Mọi dòng Mirer trên bảng ship hộ (app HmG6wtdeoiAPflkereXl8pNXgzL / bảng tblJQXEuCBxVPRek), chốt {CHOT}.')
    no(sh, 3, 1, 'SHEET NỘI BỘ — có giá vốn và lãi. KHÔNG gửi cho brand.', dam=True, fill=DO)
    tieu_de(sh, 5, COT_SH)
    h0 = 6
    for i, d in enumerate(don):
        r = h0 + i
        la_ws = d['ma'] in ma_ws
        trong_sms = 'maSms' in d
        chua_du = d.get('giaChuaDu')
        no(sh, r, 1, i + 1)
        no(sh, r, 2, d['ma'])
        no(sh, r, 3, d['ngay'])
        no(sh, r, 4, d['hang'])
        no(sh, r, 5, d['tracking'])
        no(sh, r, 6, d['nuoc'])
        no(sh, r, 7, d['nhan'])
        no(sh, r, 8, d['canKg'])
        no(sh, r, 9, d['giao'])
        no(sh, r, 10, d['cuocTinh'], tien=True, fill=DO if chua_du else None)
        no(sh, r, 11, d['thuVnd'], tien=True, fill=DO if chua_du else None)
        no(sh, r, 12, d['vonVnd'], tien=True)
        # Lãi lấy theo số THU CỦA HỆ THỐNG khi đơn đã vào SMS: với dòng mà cột "Cước tính" trên
        # Lark còn trống, "Tổng thu (Lark)" chỉ là mấy khoản lẻ, trừ vốn ra sẽ âm vô cớ. Đơn 0627
        # là đúng ca đó: Lark ghi 123.220đ còn SMS đã thu 1.526.913đ.
        no(sh, r, 13, f'=IF(Q{r}<>"",Q{r},K{r})-L{r}', tien=True)
        no(sh, r, 14, 'CÓ' if la_ws else 'không', fill=XANH if la_ws else None)
        no(sh, r, 15, 'CÓ' if trong_sms else 'CHƯA', fill=XANH if trong_sms else DO)
        no(sh, r, 16, d.get('maSms', ''))
        no(sh, r, 17, d.get('thuSms'), tien=True)
        if la_ws:
            dg, fill = 'Là đơn WholeSale — đối soát ở tab WholeSale Mirer, số hai bảng khớp nhau. KHÔNG cộng hai lần.', XANH
        elif trong_sms:
            dg, fill = 'Hệ thống đã quản và đã lên bảng kê 9.26. Ngoài phạm vi file này.', XANH
        elif chua_du:
            dg, fill = ('⚠ HỞ: cột "Cước tính" trên Lark còn TRỐNG nên "Tổng thu" không phải giá thu thật. '
                        'Đơn đã đi, đã mất tiền vốn, mà CHƯA BAO GIỜ được định giá và CHƯA vào hệ thống. Cần Đức trả lời: thu Mirer hay bên mình chịu?'), DO
        else:
            dg, fill = 'Chưa vào hệ thống.', DO
        no(sh, r, 18, dg, fill=fill, wrap=True)
    rong_cot(sh, [5, 19, 12, 8, 16, 7, 24, 9, 18, 16, 16, 16, 15, 17, 11, 19, 15, 60])


COT_TT = ['Kỳ', 'Đơn WholeSale', 'Tổng cần thu WholeSale', 'Dòng ship hộ khác', 'Ghi chú kỳ']


def sheet_tom_tat(wb, don_ws, don_sh, rt_ws):
    sh = wb.create_sheet('Tóm tắt theo tháng')
    no(sh, 1, 1, 'TÓM TẮT THEO THÁNG — MIRER', dam=True)
    no(sh, 2, 1, 'Mọi ô số là công thức đọc từ sheet "WholeSale Mirer" — sửa chi tiết thì bảng này tự cập nhật.')
    tieu_de(sh, 4, COT_TT)
    moi_ky = sorted({d['ngay'][:7] for d in don_ws} | {d['ngay'][:7] for d in don_sh})
    h0, hw = 5, 6
    for i, k in enumerate(moi_ky):
        r = h0 + i
        nhan = f'{int(k[5:7])}/{k[:4]}'
        no(sh, r, 1, nhan)
        no(sh, r, 2, f"=COUNTIFS('WholeSale Mirer'!$D${hw}:$D${rt_ws - 1},A{r})")
        no(sh, r, 3, f"=SUMIFS('WholeSale Mirer'!$W${hw}:$W${rt_ws - 1},'WholeSale Mirer'!$D${hw}:$D${rt_ws - 1},A{r})", tien=True)
        sh_ky = [d for d in don_sh if d['ngay'][:7] == k]
        no(sh, r, 4, len(sh_ky))
        ghi = '; '.join(f"{d['ma']} ({'WholeSale' if d['ma'] in {x['ma'] for x in don_ws} else ('đã lên bảng kê 9.26' if 'maSms' in d else '⚠ chưa định giá, chưa vào hệ thống')})" for d in sh_ky)
        no(sh, r, 5, ghi, wrap=True, fill=DO if '⚠' in ghi else None)
    rt = h0 + len(moi_ky)
    no(sh, rt, 1, 'TỔNG', dam=True)
    for c in (2, 4):
        L = get_column_letter(c)
        no(sh, rt, c, f'=SUM({L}{h0}:{L}{rt - 1})', dam=True)
    no(sh, rt, 3, f'=SUM(C{h0}:C{rt - 1})', tien=True, dam=True)
    for c in range(1, len(COT_TT) + 1):
        sh.cell(rt, c).fill = VANG
        sh.cell(rt, c).border = KE_TREN
    # Chốt chặn: tổng của bảng này phải bằng dòng TỔNG của sheet chi tiết, không thì một kỳ bị rơi.
    no(sh, rt + 2, 1, 'Chốt chặn')
    no(sh, rt + 3, 1, 'Lệch so với dòng TỔNG sheet chi tiết (phải bằng 0):')
    no(sh, rt + 3, 3, f"=C{rt}-'WholeSale Mirer'!W{rt_ws}", tien=True, dam=True)
    no(sh, rt + 4, 1, 'Lệch số đơn (phải bằng 0):')
    no(sh, rt + 4, 3, f"=B{rt}-COUNTA('WholeSale Mirer'!$B${hw}:$B${rt_ws - 1})", dam=True)
    rong_cot(sh, [14, 16, 24, 18, 80])


COT_KL = ['#', 'Mức', 'Việc', 'Trạng thái', 'Số tiền', 'Chi tiết']


def sheet_ket_luan(wb, don_ws, don_sh):
    sh = wb.create_sheet('Kết luận & việc còn lại', 0)
    no(sh, 1, 1, f'ĐỐI SOÁT MIRER — WHOLESALE VÀ SHIP HỘ CÁC KỲ CŨ (chốt {CHOT})', dam=True)
    no(sh, 2, 1, 'Nguồn: sheet "Tổng hợp đơn WholeSale" (Lark wiki) + bảng ship hộ Lark + hệ thống SMS.')
    tong_ws = sum(d['canThu'] for d in don_ws)
    ho = [d for d in don_sh if d.get('giaChuaDu') and 'maSms' not in d]
    no(sh, 3, 1, f'KẾT LUẬN: {len(don_ws)} đơn WholeSale, tổng cần thu {round(tong_ws):,}đ — toàn bộ CHƯA THU (cần xác minh sổ thu). '
                 f'Mirer KHÔNG có đơn bán lẻ kỳ cũ nào. Còn {len(ho)} dòng ship hộ chưa định giá cần Đức trả lời.', dam=True, wrap=True)
    tieu_de(sh, 5, COT_KL)
    muc = [
        ('ĐÃ XONG', f'{len(don_ws)} đơn WholeSale, tổng cần thu', 'Đọc từ sheet WholeSale trên Lark', round(tong_ws),
         'Kỳ 12/2025 · 1/2026 · 3/2026 · 4/2026. Chi tiết ở tab "WholeSale Mirer"; cột TỔNG CẦN THU là công thức cộng từng khoản.'),
        ('ĐÃ XONG', 'Mirer có đơn bán lẻ kỳ cũ không?', 'KHÔNG có — khác hẳn TINH', None,
         'Bảng ship hộ Lark chỉ có 4 dòng Mirer: 0463 và 0467 CHÍNH LÀ đơn WholeSale (nằm cả hai bảng), 0627 đã lên bảng kê 9.26 của hệ thống, '
         '0572 chưa định giá (mục dưới). Nên file này không có tab "Bán lẻ" như file TINH.'),
        ('ĐÃ XONG', '0463 / 0467 nằm ở CẢ HAI bảng — có cộng hai lần không?', 'Không. Số hai bảng khớp nhau', None,
         'Bảng ship hộ: 0463 = 13.053.501,84đ · 0467 = 10.225.800,63đ. Sheet WholeSale: 13.053.501đ · 10.225.801đ. Lệch dưới 1đ do làm tròn. '
         'Khác TINH: đơn 0442 của TINH lệch đúng 25.000đ vì bảng ship hộ cộng thêm phí XLHH, còn hai đơn Mirer này thì không.'),
        ('CẦN TRẢ LỜI', '26-INSLG-SV-0572 đã đi nhưng CHƯA BAO GIỜ được định giá', '⚠ Cần Đức + anh Tiệp quyết', 775174,
         'Đi 28/04/2026, FedEx 871146060358, 0,1kg, UAE, Janelle Cordero, brand ref "KSA & UAE WholeSale" (hình như là bộ chứng từ của 0547/0548). '
         'Cột "Cước tính" trên Lark TRỐNG nên "Tổng thu" chỉ ghi 77.270đ, trong khi giá vốn 775.174đ. Đơn này CHƯA vào hệ thống, CHƯA ở bảng kê nào, '
         'nên hiện bên mình đang chịu toàn bộ. Cần quyết: thu Mirer hay bên mình chịu? Em CHƯA đưa dòng này lên sheet của Mirer.'),
        ('CẦN TRẢ LỜI', 'Ngày của 0369 và 0370 là SUY LUẬN', '⚠ Cần Đức xác nhận', None,
         'Hai ô đó trên sheet WholeSale là serial 46204, và serial bị đảo ngày↔tháng ngay ở sheet nguồn. Bảng ship hộ làm chứng cho 4 ô khác và cả 4 đều đảo, '
         'nên file ghi 2026-01-07; thứ tự mã cũng khớp (giữa 0325 ngày 19/12/2025 và 0411 ngày 28/01/2026). Nhưng hai đơn này KHÔNG có dòng ship hộ nên không có nhân chứng. '
         'Nếu thực là 2026-07-01 thì chúng rơi sang kỳ tháng 7 — đổi phân kỳ, không đổi tổng.'),
        ('ĐÃ TRẢ LỜI', 'Đơn nào ĐÃ THU TIỀN?', 'Anh Tiệp 19/10/2026: "hình như đều chưa thu"', None,
         'Đã điền CHƯA THU cho toàn bộ. ⚠ Là phỏng đoán, CHƯA đối chiếu sổ thu — xác minh trước khi đòi tiền brand. Trên sheet của Mirer cột đó để TRỐNG cho họ tự điền.'),
        ('ĐÃ CHỐT', 'Format giá cũ — có điều chỉnh không?', 'Anh Tiệp 19/10/2026: giữ nguyên', None,
         'Mọi con số trong file này là số cuối.'),
        ('ĐÃ XONG', 'Ai trả cước', 'Đức xác nhận 19/10/2026', None,
         '0463 và 0467 là NGƯỜI GỬI (bên mình) trả cước → thu lại cả cước. Bảy đơn còn lại bên NHẬN trả → bên mình chỉ thu phí xử lý tờ khai + uỷ quyền + stationary.'),
        ('THÔNG TIN', 'Hệ thống SMS có gì về Mirer', 'Chỉ 1 đơn', None,
         'SMS có duy nhất 26-INSLG-SV-0116 (mã Lark 0627), đi 12/05/2026, đã billed trong bảng kê kỳ 9/2026 phát hành 01/10/2026. '
         'Không có đơn WholeSale nào trong SMS — sheet WholeSale trên Lark là nguồn duy nhất.'),
        ('ĐÃ ĐẨY', 'Đã đẩy lên sheet đối soát của Mirer', 'Hai tab mới', None,
         'Tab "Tổng hợp 12.2025-4.2026" và "WholeSale 12.2025-4.2026". KHÔNG mang giá vốn/lãi lên; cột "Đã thu?" để trống cho Mirer điền. '
         'Tab "Chi tiết ship hộ Lark" của file này là SHEET NỘI BỘ, không đẩy.'),
    ]
    for i, (muc_do, viec, tt, tien, ct) in enumerate(muc):
        r = 6 + i
        fill = DO if muc_do == 'CẦN TRẢ LỜI' else VANG
        no(sh, r, 1, i + 1, fill=fill)
        no(sh, r, 2, muc_do, dam=True, fill=fill)
        no(sh, r, 3, viec, fill=fill, wrap=True)
        no(sh, r, 4, tt, fill=fill, wrap=True)
        no(sh, r, 5, tien, tien=True, fill=fill)
        no(sh, r, 6, ct, fill=fill, wrap=True)
    rong_cot(sh, [5, 15, 42, 38, 14, 100])


def main():
    with open('scripts/du-lieu/wholesale-lark.json', encoding='utf-8') as f:
        don_ws = json.load(f)['brand']['mirer']
    with open('scripts/du-lieu/ship-ho-lark-mirer.json', encoding='utf-8') as f:
        don_sh = json.load(f)['don']

    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    rt_ws = sheet_wholesale(wb, don_ws)
    sheet_ship_ho(wb, don_sh, {d['ma'] for d in don_ws})
    sheet_tom_tat(wb, don_ws, don_sh, rt_ws)
    sheet_ket_luan(wb, don_ws, don_sh)
    wb.move_sheet('Tóm tắt theo tháng', offset=-2)
    wb.save(RA)
    print(f'{RA}: {len(wb.sheetnames)} sheet — {", ".join(wb.sheetnames)}')
    print(f'  WholeSale {len(don_ws)} đơn · tổng cần thu {round(sum(d["canThu"] for d in don_ws)):,}đ')
    print(f'  Chi tiết ship hộ {len(don_sh)} dòng')


main()
