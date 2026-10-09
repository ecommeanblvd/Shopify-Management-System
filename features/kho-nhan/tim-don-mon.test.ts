import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * CHẶN MÁY cho nguồn thứ ba của ô tìm — kênh món Lark (CEO 08/10/2026).
 *
 * Luật nằm trong SQL nên không có hàm thuần nào gọi được; bài test đọc chính tệp nguồn. Hai thứ
 * dễ mất đi âm thầm khi ai đó sửa câu truy vấn, và cả hai đều KHÔNG báo lỗi khi mất — chỉ ra
 * số sai.
 */
const NGUON = readFileSync(new URL('./tim-don.ts', import.meta.url), 'utf8');

/** Thân hàm `timMonLark` — soi riêng, không lẫn với hai nguồn kia. */
function thanTimMonLark(src: string): string {
  const i = src.indexOf('async function timMonLark');
  expect(i).toBeGreaterThan(-1);
  return src.slice(i);
}

describe('tim-don: nguồn món Lark', () => {
  /* Cột `store` KHÔNG hứa "kênh này không có trong Shopify": `#MIRER` phủ cả 253 dòng `MIRER…`
     (0 trong Shopify) lẫn 28 dòng `MIR1004–1028` (có đủ trong Shopify). Mất mệnh đề này là một
     món đứng hai dòng trong ô tìm, và hai dòng đếm "đã nhận" theo hai khoá khác nhau nên kho
     nhận được HAI chiếc cho một món. */
  it('loại món của đơn ĐÃ CÓ trong shopify_orders — không để một món đứng hai dòng', () => {
    const than = thanTimMonLark(NGUON);
    expect(than).toMatch(/NOT EXISTS \(SELECT 1 FROM shopify_orders/);
  });

  /* 77/211 dòng MTB/MXHS đang mang cờ huỷ. Nhận hàng của đơn đã huỷ là đưa vào kho một chiếc
     không có đơn nào đòi, và không có đường nào rút ra. Chặn ở CẢ HAI chỗ: câu truy vấn (cho
     rẻ) và `monConNhanDuoc` (cho đúng lúc ghi) — ô tìm có thể mở từ mười phút trước. */
  it('loại dòng đã huỷ ngay trong câu truy vấn', () => {
    expect(thanTimMonLark(NGUON)).toMatch(/huy, false/);
  });

  /* Danh sách CHO PHÉP, khai một chỗ ở `pham-vi.ts`. Viết thẳng '#MTB' vào câu truy vấn là hai
     bản của một phạm vi, rồi thêm kênh ở một chỗ mà quên chỗ kia. */
  it('phạm vi kênh đọc từ STORE_MON_LARK, không viết cứng mã kênh', () => {
    const than = thanTimMonLark(NGUON);
    expect(than).toMatch(/STORE_MON_LARK/);
    expect(than).not.toMatch(/'#MTB'|'#MXHS'/);
  });
});

/** Thân hàm `timMonReturn` — nguồn thứ tư, đồ khách trả về. */
function thanTimMonReturn(src: string): string {
  const i = src.indexOf('async function timMonReturn');
  expect(i).toBeGreaterThan(-1);
  return src.slice(i);
}

describe('tim-don: nguồn đồ khách trả về', () => {
  /* Cửa vào CEO chốt 08/10/2026. Đọc từ `TRANG_THAI_CHO_NHAN` chứ không viết cứng tên trạng
     thái vào câu truy vấn — hai bản của một phạm vi là thêm trạng thái ở một chỗ mà quên chỗ
     kia, rồi ô tìm và lệnh nhận bất đồng ý. */
  it('lọc trạng thái đọc từ TRANG_THAI_CHO_NHAN, không viết cứng', () => {
    const than = thanTimMonReturn(NGUON);
    expect(than).toMatch(/TRANG_THAI_CHO_NHAN/);
    expect(than).not.toMatch(/'Warehouse Received'|'Return-Processing'|'Pakago Received'/);
  });

  /* Đội kho nhập tay dòng WH bên Lark thì cột lookup `WH - Tiếp nhận & QC` có giá trị. Bỏ mệnh
     đề này là hai dòng WH cho một món trả về, mà bốn cột lookup bên `LOG - Import` gộp cả hai
     nên số hiện ra không nói được dòng nào là dòng nào. */
  it('loại dòng đội kho đã có WH ngay trong câu truy vấn', () => {
    expect(thanTimMonReturn(NGUON)).toMatch(/isNull\(schema\.larkLogImport\.whTiepNhanQc\)/);
  });

  /* `Return Status` là trạng thái duyệt hoàn tiền của CX, KHÔNG phải cửa kho: trong 244 dòng
     kho đã nhận có 135 `Refunded` và cả 1 `Rejected` — hàng bị từ chối hoàn tiền vẫn về kho
     thật. Lọc theo nó là bỏ sót hàng có thật. */
  it('KHÔNG lọc theo trạng thái hoàn tiền của CX', () => {
    expect(thanTimMonReturn(NGUON)).not.toMatch(/returnStatus/);
  });
});

describe('tim-don: phạm vi store của đồ return', () => {
  /* Nguồn đồ return ban đầu KHÔNG có phạm vi brand nào, nên nó mời kho nhận `#HC1317` trong khi
     `happy-clothing-global` cố ý nằm ngoài `STORE_NHAN_HANG` từ 29/09. Store phải suy từ
     `shopify_orders` — CHÍNH XÁC (461/461 dòng tra được), không đoán theo tiền tố mã đơn. */
  it('tra store từ shopify_orders và lọc qua returnVeKhoDuoc', () => {
    const than = thanTimMonReturn(NGUON);
    expect(than).toMatch(/shopify_orders so/);
    expect(than).toMatch(/returnVeKhoDuoc\(d\.shopDomain\)/);
    // Không viết cứng tên store vào câu truy vấn — phạm vi khai một chỗ ở `pham-vi.ts`.
    expect(than).not.toMatch(/meanblvd|tinhatelier|happy-clothing/);
  });
});
