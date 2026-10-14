import { describe, it, expect } from 'vitest';
import { gomBox, loaiTheoTen } from './danh-muc-box';

describe('loaiTheoTen', () => {
  it('nhận dạng thùng/hộp', () => {
    expect(loaiTheoTen('Thùng Carton 5kg')).toBe('thung');
    expect(loaiTheoTen('Hộp MEAN Ver 2')).toBe('thung');
  });

  it('nhận dạng túi', () => {
    expect(loaiTheoTen('Túi FedEx Nhỏ')).toBe('tui');
  });

  it('nhận dạng khác', () => {
    expect(loaiTheoTen('Giấy Nến Trắng')).toBe('khac');
  });

  it('bỏ qua dấu và hoa thường', () => {
    expect(loaiTheoTen('THUNG CARTON 5KG')).toBe('thung');
    expect(loaiTheoTen('thùng carton 5kg')).toBe('thung');
    expect(loaiTheoTen('TÚI FEDEX NHỎ')).toBe('tui');
    expect(loaiTheoTen('túi fedex nhỏ')).toBe('tui');
  });
});

describe('gomBox', () => {
  it('nhiều dòng kho cùng loại → MỘT box, gom record id', () => {
    const r = gomBox([
      {
        recordId: 'r1',
        lineitemName: 'Thùng Carton 5kg',
        dinhDanh: 'MEAN-CAR-40x25x25-VTĐG1-WH-1',
        kichThuoc: '40x25x25',
      },
      {
        recordId: 'r2',
        lineitemName: 'Thùng Carton 5kg',
        dinhDanh: 'MEAN-CAR-40x25x25-VTĐG1-WH-2',
        kichThuoc: '40x25x25',
      },
    ]);
    expect(r.box).toHaveLength(1);
    expect(r.box[0].larkRecordIds).toEqual(['r1', 'r2']);
    expect(r.box[0].ma).toBe('MEAN-CAR-40x25x25-VTĐG1-WH-1');
    expect(r.boLai).toHaveLength(0);
  });

  it('không đọc được kích thước → boLai kèm lý do', () => {
    const r = gomBox([{ recordId: 'r9', lineitemName: 'Hộp lạ', dinhDanh: 'X', kichThuoc: null }]);
    expect(r.box).toHaveLength(0);
    expect(r.boLai).toHaveLength(1);
    expect(r.boLai[0]).toMatchObject({
      ten: 'Hộp lạ',
      recordIds: ['r9'],
    });
    expect(r.boLai[0].lyDo).toBeTruthy();
  });

  it('cùng tên hai kích thước khác nhau → giữ dòng đầu, dòng sau vào boLai', () => {
    const r = gomBox([
      {
        recordId: 'r1',
        lineitemName: 'Thùng Carton 5kg',
        dinhDanh: 'MEAN-CAR-40x25x25-VTĐG1-WH-1',
        kichThuoc: '40x25x25',
      },
      {
        recordId: 'r2',
        lineitemName: 'Thùng Carton 5kg',
        dinhDanh: 'MEAN-CAR-40x25x30-VTĐG1-WH-2',
        kichThuoc: '40x25x30',
      },
    ]);
    expect(r.box).toHaveLength(1);
    expect(r.box[0].larkRecordIds).toEqual(['r1']);
    expect(r.boLai).toHaveLength(1);
    expect(r.boLai[0]).toMatchObject({
      ten: 'Thùng Carton 5kg',
      recordIds: ['r2'],
    });
    expect(r.boLai[0].lyDo).toBeTruthy();
  });

  it('hỗn hợp box, túi, khác', () => {
    const r = gomBox([
      {
        recordId: 'r1',
        lineitemName: 'Thùng Carton 5kg',
        dinhDanh: 'MEAN-CAR-40x25x25-VTĐG1-WH-1',
        kichThuoc: '40x25x25',
      },
      {
        recordId: 'r2',
        lineitemName: 'Túi FedEx Nhỏ',
        dinhDanh: 'FEDEX-BAG-20x15-VTĐG1-WH-1',
        kichThuoc: '20x15',
      },
      {
        recordId: 'r3',
        lineitemName: 'Giấy Nến Trắng',
        dinhDanh: 'PAPER-1',
        kichThuoc: null,
      },
    ]);
    expect(r.box).toHaveLength(2);
    expect(r.box[0].loai).toBe('thung');
    expect(r.box[1].loai).toBe('tui');
    expect(r.boLai).toHaveLength(1);
  });

  it('box không có dòng kho → box rỗng', () => {
    const r = gomBox([]);
    expect(r.box).toHaveLength(0);
    expect(r.boLai).toHaveLength(0);
  });

  it('ghi kích thước vào box.kichThuoc', () => {
    const r = gomBox([
      {
        recordId: 'r1',
        lineitemName: 'Thùng Carton 5kg',
        dinhDanh: 'MEAN-CAR-40x25x25-VTĐG1-WH-1',
        kichThuoc: '40x25x25',
      },
    ]);
    expect(r.box[0].kichThuoc).toEqual({
      daiCm: 40,
      rongCm: 25,
      caoCm: 25,
    });
  });

  it('ghi kích thước chỉ 2 chiều', () => {
    const r = gomBox([
      {
        recordId: 'r1',
        lineitemName: 'Túi FedEx Nhỏ',
        dinhDanh: 'FEDEX-BAG-20x15-VTĐG1-WH-1',
        kichThuoc: '20x15',
      },
    ]);
    expect(r.box[0].kichThuoc).toEqual({
      daiCm: 20,
      rongCm: 15,
      caoCm: null,
    });
  });
});
