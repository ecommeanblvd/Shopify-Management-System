# -*- coding: utf-8 -*-
"""Dựng sổ Excel chi tiết mảng ship từ JSON của `xuat-chi-tiet-ship.ts`.

    python3 scripts/du-lieu/dung-so-chi-tiet-ship.py ra.json so.xlsx [--ketLuan ketluan.json]

Sổ để NGƯỜI KIỂM BẰNG TAY, nên hai thứ quan trọng hơn cái đẹp:

1. **Cột "Lệch cộng"** ở sheet *Theo kiện* là CÔNG THỨC Excel cộng lại mọi mục chi phí rồi trừ
   khỏi tổng cước. Khác 0 nghĩa là có khoản nào hãng tính mà hệ thống chưa bóc ra cột — đọc được
   ngay bằng mắt, không phải tin lời ai.
2. **Mọi con số là công thức hoặc số thô từ CSDL**, không có số nào tính sẵn trong python rồi
   dán vào — để sửa một ô là cả sổ chạy lại theo.

Tiền giữ nguyên VNĐ. Tổng ở hàng cuối mỗi sheet dùng SUBTOTAL(109;…) nên khi CEO bật bộ lọc thì
tổng tự co theo phần đang xem — SUM thì không.
"""
import json
import sys
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

SRC, OUT = sys.argv[1], sys.argv[2]
# Tuỳ chọn: JSON của `doi-soat-lai-ship.ts` để dựng sheet "Khớp hai số".
KL = None
if '--ketLuan' in sys.argv:
    KL = json.load(open(sys.argv[sys.argv.index('--ketLuan') + 1], encoding='utf-8'))['don']
d = json.load(open(SRC, encoding='utf-8'))

FONT = 'Arial'
H = Font(name=FONT, bold=True, color='FFFFFF', size=9)
HF = PatternFill('solid', fgColor='1F3864')
HF2 = PatternFill('solid', fgColor='2F5597')   # nhóm cột chi phí
HF3 = PatternFill('solid', fgColor='7F6000')   # nhóm cột hoá đơn
B = Font(name=FONT, size=9)
BB = Font(name=FONT, size=9, bold=True)
NOTE = Font(name=FONT, size=9, italic=True, color='475569')
RED = Font(name=FONT, size=9, color='FF0000')
YEL = PatternFill('solid', fgColor='FFFF00')
GREY = PatternFill('solid', fgColor='F1F5F9')
thin = Side(style='thin', color='CBD5E1')
BOX = Border(left=thin, right=thin, top=thin, bottom=thin)
MONEY = '#,##0;(#,##0);-'
NUM2 = '#,##0.00;(#,##0.00);-'
INT = '#,##0'
PCT = '0.0%'
BRAND = {'tinhatelier.myshopify.com', 'mirermirer-official.myshopify.com'}

wb = Workbook()


def head(ws, cols, fills=None):
    """cols = [(tiêu đề, bề rộng, định dạng)]; fills = {chỉ số cột 1-based: PatternFill}."""
    for i, (t, w, _f) in enumerate(cols, start=1):
        c = ws.cell(row=1, column=i, value=t)
        c.font = H
        c.fill = (fills or {}).get(i, HF)
        c.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'C2'
    ws.row_dimensions[1].height = 34


def tô(ws, r, cols):
    for i, (_t, _w, f) in enumerate(cols, start=1):
        c = ws.cell(row=r, column=i)
        c.border = BOX
        c.font = B
        if f:
            c.number_format = f


def hàng_tổng(ws, r, cols, cot_tong):
    """Hàng TỔNG dùng SUBTOTAL(109) để co theo bộ lọc."""
    ws.cell(row=r, column=1, value='TỔNG (theo phần đang lọc)').font = BB
    for i in cot_tong:
        L = get_column_letter(i)
        c = ws.cell(row=r, column=i, value=f'=SUBTOTAL(109,{L}2:{L}{r-1})')
        c.font = BB
        c.number_format = cols[i-1][2] or MONEY
        c.fill = YEL
    for i in range(1, len(cols) + 1):
        ws.cell(row=r, column=i).border = BOX
    ws.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{r-1}'


# ───────────────────── Theo kiện ─────────────────────
ws = wb.active
ws.title = 'Theo kiện'
# (tiêu đề, bề rộng, định dạng)
CK = [
    ('Mã đơn', 14, None), ('Mã LOG', 11, None), ('Mã vận đơn', 20, None),
    ('Ngày tạo nhãn', 12, None), ('Tháng', 8, None), ('Store', 20, None),
    ('Nước', 6, None), ('Thành phố', 14, None), ('Loại địa chỉ', 11, None),
    ('Hãng', 8, None), ('Tài khoản hãng', 30, None),
    ('Cân thật kg', 9, NUM2), ('Cân SMS kg', 9, NUM2), ('Cân tính phí kg', 10, NUM2),
    ('Cân trên HĐ kg', 10, NUM2), ('Dài', 6, NUM2), ('Rộng', 6, NUM2), ('Cao', 6, NUM2),
    ('Bao bì', 8, None),
    ('SỐ HOÁ ĐƠN', 22, None), ('Ngày HĐ', 11, None), ('Số dòng HĐ', 9, INT),
    ('Tổng dòng HĐ (đ)', 14, MONEY), ('Thuế NK trên tờ (đ)', 14, MONEY),
    ('Ngày gửi theo HĐ', 12, None),
    ('Cước gốc (đ)', 13, MONEY), ('Giảm giá (đ)', 13, MONEY), ('Cước ròng (đ)', 13, MONEY),
    ('Xăng dầu (đ)', 12, MONEY), ('% xăng dầu', 9, PCT),
    ('Vùng sâu (đ)', 11, MONEY), ('Phụ phí mùa cao (đ)', 12, MONEY),
    ('Ký nhận (đ)', 11, MONEY), ('Nhà dân (đ)', 11, MONEY), ('Hạng địa chỉ', 11, None),
    ('Sửa địa chỉ (đ)', 11, MONEY), ('Xử lý nhập khẩu (đ)', 13, MONEY),
    ('Nguy cơ cao (đ)', 12, MONEY), ('GoGreen (đ)', 10, MONEY),
    ('Không băng tải (đ)', 12, MONEY), ('VAT (đ)', 11, MONEY),
    ('TỔNG CƯỚC (đ)', 14, MONEY), ('LỆCH CỘNG (đ)', 13, MONEY),
    ('Nguồn cước', 13, None), ('Nhập cước lúc', 12, None),
    ('Thu khách (nguyên tệ)', 12, NUM2), ('Đơn vị', 7, None), ('Giảm ship cho khách', 11, NUM2),
    ('Tỉ giá', 9, INT), ('Thu brand (đ)', 13, MONEY),
    ('Trạng thái đối soát', 15, None), ('Loại lỗi hãng', 13, None),
    ('Lệch lúc duyệt (đ)', 13, MONEY), ('Đã thu hồi (đ)', 13, MONEY),
    ('Số chứng từ hoàn tiền', 14, None), ('Ghi chú đối soát', 30, None),
    ('Các đơn trong kiện', 22, None),
    ('Trạng thái giao', 12, None), ('Ngày giao', 12, None),
]
FILLS_K = {i: HF2 for i in range(26, 44)}
FILLS_K.update({i: HF3 for i in range(20, 26)})
head(ws, CK, FILLS_K)

r = 2
for x in d['kien']:
    v = [
        x['maDon'], x['maLog'], x['maVanDon'], x['ngayTaoNhan'], x['thang'],
        (x['store'] or '').replace('.myshopify.com', ''),
        x['nuoc'], x['thanhPho'], x['loaiDiaChi'], x['hangTheoKien'], x['taiKhoanHang'],
        x['canThat'], x['canSms'], x['canTinhPhi'], x['canTrenHoaDon'],
        x['dai'], x['rong'], x['cao'], x['loaiBaoBi'],
        x['soHoaDon'], x['ngayHoaDonSom'], x['soDongHoaDon'], x['tongDongHoaDon'],
        x['thueNhapKhauTrenTo'], x['ngayGuiTheoHoaDon'],
        x['cuocGoc'], x['giamGia'],
        f'=Z{r}+AA{r}',                      # cước ròng = gốc + giảm (giảm lưu số âm)
        x['xangDau'],
        f'=IF(AB{r}=0,"",AC{r}/AB{r})',      # % xăng dầu trên cước ròng
        x['vungSau'], x['phuPhiMuaCao'], x['kyNhanTrucTiep'], x['nhaDan'], x['hangDiaChi'],
        x['suaDiaChi'], x['xuLyNhapKhau'], x['nguyCoCao'], x['gogreen'], x['khongBangTai'],
        x['vat'], x['tongCuoc'],
        # LỆCH CỘNG: tổng cước trừ đi tổng mọi mục. Khác 0 ⇒ còn khoản chưa bóc ra cột.
        f'=IF(AP{r}="","",AP{r}-(Z{r}+AA{r}+AC{r}+AE{r}+AF{r}+AG{r}+AH{r}+AJ{r}+AK{r}+AL{r}+AM{r}+AN{r}+AO{r}))',
        x['nguonCuoc'], x['nhapCuocLuc'],
        x['thuKhachNguyenTe'], x['donViTien'], x['giamShipChoKhach'],
        x['tyGiaStore'], x['thuBrand'],
        x['trangThaiDoiSoat'], x['loaiLoiHang'], x['lechLucDuyet'], x['daThuHoi'],
        x['soChungTuHoanTien'], x['ghiChuDoiSoat'],
        ' + '.join(x['cacDonTrongKien']) if x['cacDonTrongKien'] else None,
        x['trangThaiGiao'], x['ngayGiao'],
    ]
    for i, val in enumerate(v, start=1):
        ws.cell(row=r, column=i, value=val)
    tô(ws, r, CK)
    if not x['soHoaDon']:
        ws.cell(row=r, column=20).fill = YEL
    if x['canThat'] and x['canTinhPhi'] and x['canTinhPhi'] > 3 * x['canThat']:
        for i in (12, 14):
            ws.cell(row=r, column=i).fill = YEL
            ws.cell(row=r, column=i).font = RED
    r += 1
hàng_tổng(ws, r, CK, [23, 24, 26, 27, 28, 29, 31, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 43, 53, 54])
ws.cell(row=r + 2, column=1, value='LỆCH CỘNG khác 0 ⇒ hãng tính một khoản mà hệ thống chưa bóc ra cột riêng. Ô vàng cột SỐ HOÁ ĐƠN ⇒ có cước mà chưa nối được về tờ hoá đơn nào. Cân thật/cân tính phí tô đỏ ⇒ hãng tính cân hơn 3 lần cân thật.').font = NOTE

# ───────────────────── Theo đơn ─────────────────────
ws = wb.create_sheet('Theo đơn')
CD = [
    ('Mã đơn', 14, None), ('Tháng', 8, None), ('Store', 20, None), ('Nước', 6, None),
    ('Hãng', 8, None), ('Số kiện', 7, INT), ('Kiện có HĐ', 9, INT),
    ('Số hoá đơn', 26, None),
    ('Thu khách (nguyên tệ)', 12, NUM2), ('Tỉ giá', 9, INT),
    ('THU (đ)', 14, MONEY), ('CHI (đ)', 14, MONEY), ('LÃI/LỖ (đ)', 14, MONEY), ('%', 8, PCT),
    ('Cước hàng hoàn (đ)', 13, MONEY),
    ('Trạng thái đối soát', 15, None), ('Đã thu hồi (đ)', 12, MONEY),
    ('So được?', 9, None), ('Nguồn thu', 18, None), ('Ghi chú', 34, None),
]
head(ws, CD)

hoan_theo_don = {}
for h in d['hoan']:
    hoan_theo_don[h['maDon']] = hoan_theo_don.get(h['maDon'], 0) + (h['tong'] or 0)

theo_don = {}
for x in d['kien']:
    theo_don.setdefault(x['maDon'], []).append(x)

# mã đơn → (thu, chi, so-được?) — sheet "Khớp hai số" dùng lại, không tính lần hai.
det = {}

r = 2
for ma, ks in sorted(theo_don.items(), key=lambda kv: kv[1][0]['ngayTaoNhan']):
    k0 = ks[0]
    la_brand = (k0['store'] or '') in BRAND
    if la_brand:
        co = [k for k in ks if k['thuBrand'] is not None]
        thu = sum(k['thuBrand'] for k in co) if co else None
        nguon = 'brand_charge_vnd'
    else:
        thu = (k0['thuKhachNguyenTe'] or 0) * (k0['tyGiaStore'] or 0) if k0['tyGiaStore'] else None
        nguon = 'total_shipping × tỉ giá'
    co_bill = [k for k in ks if k['tongCuoc'] is not None]
    hoan = hoan_theo_don.get(ma, 0)
    chi = (sum(k['tongCuoc'] for k in co_bill) + hoan) if co_bill else (hoan or None)
    du = thu is not None and chi is not None and len(co_bill) == len(ks)
    det[ma] = (thu, chi, du)
    ghi = []
    if len(co_bill) < len(ks):
        ghi.append(f'chỉ {len(co_bill)}/{len(ks)} kiện có cước ⇒ CHI CHƯA ĐỦ, chưa so được')
    if thu is None:
        ghi.append('chưa có giá thu')
    if len(ks) > 1:
        ghi.append(f'{len(ks)} kiện đã ghép về một đơn')
    if any(k['cacDonTrongKien'] for k in ks):
        ghi.append('kiện chở nhiều đơn — xem cột "Các đơn trong kiện" ở sheet Theo kiện')
    v = [
        ma, k0['thang'], (k0['store'] or '').replace('.myshopify.com', ''), k0['nuoc'],
        k0['hangTheoKien'], len(ks), len(co_bill),
        ' + '.join(sorted({k['soHoaDon'] for k in ks if k['soHoaDon']})) or None,
        k0['thuKhachNguyenTe'] if not la_brand else None,
        k0['tyGiaStore'] if not la_brand else None,
        thu, chi,
        f'=IF(OR(K{r}="",L{r}="",G{r}<>F{r}),"",K{r}-L{r})',
        f'=IF(OR(M{r}="",K{r}=0),"",M{r}/K{r})',
        hoan or None,
        ';'.join(sorted({k['trangThaiDoiSoat'] for k in ks})),
        sum(k['daThuHoi'] or 0 for k in ks) or None,
        'Có' if du else 'Không',
        nguon, ' · '.join(ghi) or None,
    ]
    for i, val in enumerate(v, start=1):
        ws.cell(row=r, column=i, value=val)
    tô(ws, r, CD)
    if not du:
        for i in range(1, len(CD) + 1):
            ws.cell(row=r, column=i).fill = GREY
    r += 1
hàng_tổng(ws, r, CD, [11, 12, 13, 15, 17])
ws.cell(row=r + 2, column=1, value='Dòng TÔ XÁM = chưa so được (thiếu giá thu, hoặc còn kiện chưa có cước) nên cột LÃI/LỖ để trống.').font = NOTE
ws.cell(row=r + 3, column=1, value='QUAN TRỌNG: hàng TỔNG cộng THU và CHI của MỌI dòng, còn LÃI/LỖ chỉ cộng dòng so được — nên TỔNG thu trừ TỔNG chi KHÔNG bằng TỔNG lãi. Lọc cột "So được?" = Có thì ba cột khớp nhau.').font = Font(name=FONT, size=9, bold=True, color='FF0000')

# ───────────────────── Hàng hoàn ─────────────────────
ws = wb.create_sheet('Hàng hoàn')
CH = [
    ('Mã đơn', 14, None), ('Số hoá đơn', 20, None), ('Ngày HĐ', 11, None),
    ('Mã vận đơn', 20, None), ('Cân kg', 9, NUM2),
    ('Cước gốc (đ)', 13, MONEY), ('Giảm giá (đ)', 13, MONEY), ('Xăng dầu (đ)', 12, MONEY),
    ('Thuế NK (đ)', 12, MONEY), ('VAT (đ)', 11, MONEY), ('Khác (đ)', 11, MONEY),
    ('TỔNG (đ)', 13, MONEY), ('Ghi chú', 40, None),
]
head(ws, CH)
r = 2
for h in d['hoan']:
    v = [h['maDon'], h['soHoaDon'], h['ngayHoaDon'], h['maVanDon'], h['can'],
         h['cuocGoc'], h['giamGia'], h['xangDau'], h['thueNhapKhau'], h['vat'],
         h['khac'], h['tong'], h['ghiChu']]
    for i, val in enumerate(v, start=1):
        ws.cell(row=r, column=i, value=val)
    tô(ws, r, CH)
    r += 1
hàng_tổng(ws, r, CH, [6, 7, 8, 9, 10, 11, 12])
ws.cell(row=r + 2, column=1, value='Cước mình trả để lấy hàng VỀ. Gắn về ĐƠN (carrier_bill_lines.return_of_order_id), không gắn về kiện, nên nó cộng vào cột CHI ở sheet Theo đơn.').font = NOTE

# ───────────────────── Hoá đơn hãng ─────────────────────
ws = wb.create_sheet('Hoá đơn hãng')
CHD = [
    ('Số hoá đơn', 22, None), ('Tài khoản hãng', 34, None), ('Ngày HĐ', 11, None),
    ('Kỳ từ', 11, None), ('Kỳ đến', 11, None),
    ('Tiền trên tờ', 15, MONEY), ('Tiền trên PDF', 15, MONEY), ('Đơn vị', 7, None),
    ('Tỉ giá', 10, NUM2),
    ('Số dòng', 8, INT), ('Dòng nối được kiện', 11, INT), ('Tổng các dòng (đ)', 15, MONEY),
    ('LỆCH tờ − dòng', 15, MONEY), ('Tên file', 40, None),
]
head(ws, CHD)
r = 2
for b in d['hoaDon']:
    v = [b['soHoaDon'], b['taiKhoanHang'], b['ngayHoaDon'], b['kyTu'], b['kyDen'],
         b['tienTrenTo'], b['tienTrenPdf'], b['donViTien'], b['tyGia'],
         b['soDong'], b['soDongGanDuocKien'], b['tongDong'],
         f'=IF(OR(F{r}="",L{r}=""),"",F{r}-L{r})', b['tenFile']]
    for i, val in enumerate(v, start=1):
        ws.cell(row=r, column=i, value=val)
    tô(ws, r, CHD)
    if b['soDong'] and b['soDongGanDuocKien'] is not None and b['soDongGanDuocKien'] < b['soDong']:
        ws.cell(row=r, column=11).fill = YEL
    r += 1
hàng_tổng(ws, r, CHD, [6, 7, 10, 11, 12, 13])
ws.cell(row=r + 2, column=1, value='LỆCH tờ − dòng khác 0 ⇒ tổng tiền khai trên tờ không bằng tổng các dòng đã nhập. Ô vàng ⇒ tờ còn dòng chưa nối được về kiện nào (những dòng đó không vào chi phí đơn nào).').font = NOTE

# ───────────────────── Ship hộ ─────────────────────
ws = wb.create_sheet('Ship hộ')
CS = [
    ('Mã đơn', 20, None), ('Brand', 12, None), ('Tháng', 8, None), ('Tạo lúc', 12, None),
    ('Hãng', 8, None), ('Tài khoản hãng', 30, None), ('Nước', 6, None),
    ('Mã vận đơn', 20, None), ('Cân kg', 9, NUM2),
    ('Trạng thái', 12, None), ('Đối soát', 12, None), ('Quyết định', 14, None),
    ('Thu dự tính (đ)', 14, MONEY), ('Thu thực (đ)', 14, MONEY), ('Thuế NK (đ)', 12, MONEY),
    ('Giá vốn dự tính (đ)', 14, MONEY), ('Giá vốn thực (đ)', 14, MONEY),
    ('THU dùng (đ)', 14, MONEY), ('CHI dùng (đ)', 14, MONEY), ('LÃI/LỖ (đ)', 14, MONEY),
    ('Bảng kê', 10, None), ('Ngày gửi', 11, None), ('Ngày lấy hàng', 12, None),
    ('Bóc chi tiết hoá đơn (JSON)', 60, None),
]
head(ws, CS)
r = 2
for h in d['shipHo']:
    # Cùng luật `thuChiShipHo`: thu thực ?? dự tính; thu thực thì PHẢI cộng duty vào thu vì
    # `actual_charged_vnd` không gồm duty còn `actual_carrier_cost_vnd` có.
    thu_thuc = h['thuThuc']
    thu = (thu_thuc + (h['thueNhapKhau'] or 0)) if thu_thuc is not None else h['thuDuTinh']
    chi = h['giaVonThuc'] if h['giaVonThuc'] is not None else h['giaVonDuTinh']
    v = [h['maDon'], h['brand'], h['thang'], h['taoLuc'], h['hangTheoKey'], h['taiKhoanHang'],
         h['nuoc'], h['maVanDon'], h['can'], h['trangThai'], h['trangThaiDoiSoat'],
         h['quyetDinh'], h['thuDuTinh'], h['thuThuc'], h['thueNhapKhau'],
         h['giaVonDuTinh'], h['giaVonThuc'], thu, chi,
         f'=IF(OR(R{r}="",S{r}=""),"",R{r}-S{r})',
         'có' if h['bangKe'] else None, h['ngayGui'], h['ngayLayHang'],
         json.dumps(h['bocChiTietHoaDon'], ensure_ascii=False) if h['bocChiTietHoaDon'] else None]
    for i, val in enumerate(v, start=1):
        ws.cell(row=r, column=i, value=val)
    tô(ws, r, CS)
    r += 1
hàng_tổng(ws, r, CS, [13, 14, 15, 16, 17, 18, 19, 20])
ws.cell(row=r + 2, column=1, value='THU dùng = thu thực + thuế NK, hoặc thu dự tính khi chưa đối soát. Phải cộng thuế NK vì actual_charged_vnd KHÔNG gồm duty còn actual_carrier_cost_vnd thì CÓ — quên là margin âm mọi tháng (CEO 28/09/2026).').font = NOTE

# ───────────────────── Khớp hai số ─────────────────────
if KL is not None:
    ws = wb.create_sheet('Khớp hai số')
    ws['A1'] = 'Vì sao tổng của sổ này KHÁC con số kết luận — bóc đủ từng đơn'
    ws['A1'].font = Font(name=FONT, bold=True, size=13)
    ws['A2'] = ('Sổ này để MỖI ĐƠN MỘT DÒNG nên không gộp đơn đi ghép chung kiện, và chỉ lấy kiện '
                'trong cửa sổ thời gian. Script kết luận thì gộp, và lấy mọi kiện của đơn. '
                'Hai cách đều đúng cho việc của nó; dưới đây là đủ các đơn làm hai số lệch nhau.')
    ws['A2'].font = NOTE
    ws['A2'].alignment = Alignment(wrap_text=True, vertical='top')
    ws.row_dimensions[2].height = 30

    klsp = [x for x in KL if x['nguon'] == 'shopify'
            and x['thuVnd'] is not None and x['chiVnd'] is not None]
    CKH = [
        ('Nguyên nhân', 34, None), ('Mã đơn', 34, None),
        ('Sổ này: thu (đ)', 14, MONEY), ('Sổ này: chi (đ)', 14, MONEY), ('Sổ này: lãi (đ)', 14, MONEY),
        ('Kết luận: thu (đ)', 14, MONEY), ('Kết luận: chi (đ)', 14, MONEY), ('Kết luận: lãi (đ)', 14, MONEY),
        ('Lệch lãi (đ)', 14, MONEY), ('Giải thích', 72, None),
    ]
    head(ws, CKH)
    ws.freeze_panes = 'C2'
    r = 2

    def dong_khop(ngn, ma, t1, c1, t2, c2, gt):
        global r
        ws.cell(row=r, column=1, value=ngn)
        ws.cell(row=r, column=2, value=ma)
        ws.cell(row=r, column=3, value=t1)
        ws.cell(row=r, column=4, value=c1)
        ws.cell(row=r, column=5, value=(f'=IF(OR(C{r}="",D{r}=""),"",C{r}-D{r})'))
        ws.cell(row=r, column=6, value=t2)
        ws.cell(row=r, column=7, value=c2)
        ws.cell(row=r, column=8, value=(f'=IF(OR(F{r}="",G{r}=""),"",F{r}-G{r})'))
        ws.cell(row=r, column=9, value=(
            f'=IF(AND(E{r}="",H{r}=""),0,IF(H{r}="",-E{r},IF(E{r}="",H{r},H{r}-E{r})))'))
        ws.cell(row=r, column=10, value=gt)
        tô(ws, r, CKH)
        ws.cell(row=r, column=10).alignment = Alignment(wrap_text=True, vertical='top')
        ws.row_dimensions[r].height = 30
        r += 1

    for x in sorted((y for y in klsp if y['soDonGop'] > 1), key=lambda y: y['ma']):
        mas = x['ma'].split(' + ')
        co = [m for m in mas if det.get(m) and det[m][2]]
        bo = [m for m in mas if m not in co]
        t1 = sum(det[m][0] for m in co) if co else None
        c1 = sum(det[m][1] for m in co) if co else None
        dong_khop('Đơn đi ghép chung một kiện', x['ma'], t1, c1, x['thuVnd'], x['chiVnd'],
                  f"Sổ này tính riêng {', '.join(co)} và BỎ {', '.join(bo)} (không có kiện riêng nên không có cước). "
                  f"Kết luận gộp cả cặp: thu cộng lại, cước kiện tính một lần.")

    for x in sorted(klsp, key=lambda y: y['ma']):
        if x['soDonGop'] > 1:
            continue
        dd = det.get(x['ma'])
        if dd and dd[2] and abs((dd[1] or 0) - x['chiVnd']) >= 1:
            dong_khop('Kiện nằm ngoài cửa sổ thời gian', x['ma'], dd[0], dd[1],
                      x['thuVnd'], x['chiVnd'],
                      'Đơn còn kiện gửi ở tháng ngoài kỳ. Sổ này chỉ cộng cước kiện trong kỳ; '
                      'kết luận cộng mọi kiện của đơn nên chi cao hơn và sát thực hơn.')

    chi_det = {m for m, (t, c, du) in det.items() if du}
    chi_kl = set()
    for x in klsp:
        chi_kl.update(x['ma'].split(' + '))
    for m in sorted(chi_det - chi_kl):
        dd = det[m]
        dong_khop('Chỉ SỔ NÀY coi là so được', m, dd[0], dd[1], None, None,
                  'Sổ này thấy mọi kiện TRONG KỲ đều có cước nên tính được; kết luận thấy đơn còn '
                  'kiện (trong hoặc ngoài kỳ) chưa có hoá đơn nên loại ra để không cộng chi thiếu.')
    for m in sorted(chi_kl - chi_det):
        x = next(y for y in klsp if m in y['ma'].split(' + '))
        dong_khop('Chỉ KẾT LUẬN coi là so được', m, None, None, None, None,
                  f"Đơn này nằm trong đơn vị gộp \"{x['ma']}\" của kết luận; sổ này để rời nên nó "
                  'không có cước và bị loại.')

    r_tong = r
    ws.cell(row=r, column=1, value='TỔNG LỆCH LÃI').font = BB
    cc = ws.cell(row=r, column=9, value=f'=SUM(I2:I{r-1})')
    cc.font = BB
    cc.number_format = MONEY
    cc.fill = YEL
    for i in range(1, len(CKH) + 1):
        ws.cell(row=r, column=i).border = BOX
    lai_kl = sum(x['thuVnd'] - x['chiVnd'] for x in klsp)
    lai_so = sum(t - c for t, c, du in det.values() if du)
    r += 2
    ws.cell(row=r, column=1, value='PHÉP KIỂM').font = BB
    for nhan, so in [('Lãi theo script kết luận (đ)', lai_kl),
                     ('Lãi theo sheet Theo đơn, chỉ dòng so được (đ)', lai_so)]:
        ws.cell(row=r, column=2, value=nhan).font = B
        c = ws.cell(row=r, column=3, value=so)
        c.font = B
        c.number_format = MONEY
        r += 1
    ws.cell(row=r, column=2, value='Hiệu hai dòng trên').font = BB
    c = ws.cell(row=r, column=3, value=f'=C{r-2}-C{r-1}')
    c.font = BB
    c.number_format = MONEY
    ws.cell(row=r, column=4, value='phải bằng TỔNG LỆCH LÃI ở trên').font = NOTE
    r += 1
    ws.cell(row=r, column=2, value='TỔNG LỆCH LÃI đã bóc ở trên').font = BB
    c = ws.cell(row=r, column=3, value=f'=I{r_tong}')
    c.font = BB
    c.number_format = MONEY
    r += 1
    ws.cell(row=r, column=2, value='CHÊNH CÒN LẠI (phải bằng 0)').font = BB
    c = ws.cell(row=r, column=3, value=f'=C{r-2}-C{r-1}')
    c.font = Font(name=FONT, size=9, bold=True, color='FF0000')
    c.number_format = MONEY
    c.fill = YEL

# ───────────────────── Đọc sao ─────────────────────
ws = wb.create_sheet('Đọc sao')
ws['A1'] = 'Sổ này đọc thế nào'
ws['A1'].font = Font(name=FONT, bold=True, size=14)
ws['A2'] = f"Kỳ {d['tu']} → trước {d['den']} · nguồn: scripts/du-lieu/xuat-chi-tiet-ship.ts (chỉ đọc)"
ws['A2'].font = NOTE
for col, w in zip('AB', [30, 120]):
    ws.column_dimensions[col].width = w
GIAI = [
    ('Theo kiện', 'Một dòng cho mỗi KIỆN, đủ mọi mục chi phí hãng tính. Cột LỆCH CỘNG là công thức: tổng cước trừ tổng các mục. Khác 0 là có khoản chưa bóc ra cột.'),
    ('Theo đơn', 'Một dòng cho mỗi ĐƠN. Thu tính MỘT LẦN; chi là tổng mọi kiện của đơn cộng cước hàng hoàn. Dòng xám = chưa so được.'),
    ('Hàng hoàn', 'Cước trả để lấy hàng về. Gắn về đơn, không gắn về kiện.'),
    ('Hoá đơn hãng', 'Từng tờ hoá đơn trong kỳ. Cột LỆCH tờ − dòng để soi tờ nhập thiếu dòng.'),
    ('Ship hộ', 'Đơn ship hộ cho brand — nguồn thu/chi khác hẳn, nên để sheet riêng.'),
    ('Khớp hai số', 'Bóc đủ từng đơn làm tổng của sổ này khác con số kết luận. Hai cách tính đều đúng cho việc của nó; sheet này chứng minh không còn chỗ lệch nào khác.'),
    ('', ''),
    ('Cước ròng', 'Cước gốc + Giảm giá. Giảm giá lưu là SỐ ÂM, nên đây là phép cộng chứ không phải trừ.'),
    ('% xăng dầu', 'Xăng dầu / Cước ròng. Hãng công bố theo TUẦN; lệch mức tuần là dấu hiệu tính sai.'),
    ('Cân tính phí', 'Cân hãng dùng để ra giá — lớn hơn cân thật là bình thường (cân thể tích), nhưng hơn 3 lần thì tô đỏ.'),
    ('Thu khách', 'Phí ship khách trả SAU giảm giá (Shopify discountedPriceSet), nhân tỉ giá của store.'),
    ('Thu brand', 'Store brand (TINH Atelier, Mirer) thì doanh thu là tiền THU BRAND từng kiện, không phải tiền khách cuối trả.'),
    ('Tỉ giá', 'Một mức CỨNG 26.000 đ/USD khai ở stores.fx_cost_per_order_currency, dùng cho mọi tháng. Mọi con số quy đổi tỉ lệ thuận với nó.'),
    ('Hàng TỔNG', 'Dùng SUBTOTAL nên khi bật bộ lọc thì tổng tự co theo phần đang xem.'),
]
r = 4
for a, b in GIAI:
    ws.cell(row=r, column=1, value=a).font = BB
    c = ws.cell(row=r, column=2, value=b)
    c.font = B
    c.alignment = Alignment(wrap_text=True, vertical='top')
    ws.row_dimensions[r].height = 28 if b else 8
    r += 1

wb.save(OUT)
print('saved', OUT)
