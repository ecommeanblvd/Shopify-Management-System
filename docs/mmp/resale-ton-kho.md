# SMS → MMP: Tồn kho Resale — hợp đồng tích hợp

> Bản MMP gửi **26/10/2026** (CEO dán vào phiên làm việc). Bản gốc nằm ở scratchpad `/tmp`
> của phiên MMP và **đã bị dọn**, nên lưu lại ở đây — hợp đồng không được chỉ sống trong chat.

SMS gửi sang MMP **ảnh chụp toàn bộ tồn kho resale** (hàng MEAN đã mua đứt của brand), gồm số
lượng và **ngày nhập kho từng lô**. MMP dùng để nhân sự quyết đưa hàng lên bán lại và giảm bao
nhiêu %. SMS vẫn là nguồn sự thật về tồn kho; MMP chỉ đọc, không đẩy ngược.

## Endpoint

| Mục | Giá trị |
| --- | --- |
| Method | `POST` |
| URL production | `https://portal.meanblvd.com/api/integration/resale/ton-kho` |
| Dự phòng | `https://mean-merchant-portal.up.railway.app` (cùng ứng dụng) |
| Content-Type | `application/json` |
| Secret | `MMP_WEBHOOK_SECRET` production — **cùng secret** với webhook `ship-ho/order-updates` |
| Trần | 8 MB mỗi request, tối đa 20.000 dòng |

## Ký HMAC

| Header | Giá trị |
| --- | --- |
| `x-mean-timestamp` | Unix epoch **giây** (số nguyên) |
| `x-mean-signature` | `sha256=` + hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)) |

Ký trên **đúng chuỗi byte đã gửi**; không stringify lại sau khi ký. Lệch giờ > ±300 giây → 401.
Mỗi lần retry phải tính lại timestamp và chữ ký.

→ SMS dùng `signMmpPayload` (`features/mmp/hmac.ts:101`) — **đúng y hệt scheme này**, và
`features/ship-ho/statement-push.ts:80` đã ký bằng cùng biến secret.

## Payload

```json
{
  "snapshotId": "resale-2026-10-24T02:00:00Z",
  "guiLuc": "2026-10-24T02:00:00Z",
  "items": [
    { "sku": "MR-X-BLK-S", "soLuong": 5, "ngayNhapKho": "2026-01-05", "kho": "An Phú" }
  ]
}
```

| Trường | Bắt buộc | Ý nghĩa |
| --- | --- | --- |
| `snapshotId` | Có | Mã duy nhất do SMS đặt, ≤200 ký tự. Gửi lại cùng mã thì MMP bỏ qua ⇒ retry an toàn. |
| `guiLuc` | Có | Thời điểm SMS chụp tồn. Không sớm hơn giờ MMP quá 5 phút. |
| `items[]` | Có | Toàn bộ dòng tồn resale, ≤20.000. Mảng rỗng = hết hàng resale. |
| `items[].sku` | Có | **Global SKU** của biến thể đang bán trên MEAN. |
| `items[].shopifyVariantId` | Không | MMP ghép theo ID này TRƯỚC, không khớp mới ghép theo `sku`. |
| `items[].soLuong` | Có | Số nguyên ≥ 0. Dòng bằng 0 bị bỏ qua. |
| `items[].ngayNhapKho` | Có | Ngày nhập của lô. Ở tương lai quá 1 ngày → **cả ảnh chụp bị từ chối**. |
| `items[].kho` | Không | Tên kho, chỉ để hiển thị. |

**Quy tắc ảnh chụp đầy đủ:** ảnh mới **thay hẳn** ảnh trước; biến thể không có trong ảnh được
hiểu là tồn 0. Không gửi chênh lệch. Một biến thể có nhiều dòng với `ngayNhapKho` khác nhau;
MMP tính tuổi theo **lô cũ nhất còn tồn**. Lô bán bớt → gửi lại số còn, **giữ nguyên ngày**.
Lô bán hết → bỏ dòng. Dòng chưa ghép được biến thể vẫn được lưu vào danh sách "Chưa ghép được".

## Phản hồi

`200` `{ ok, daApDung, ghep, chuaGhep, boQuaKhong }`. `daApDung:false` + `boQua:"trung"` =
snapshotId đã nhận; `boQua:"cu"` = MMP đã có ảnh mới hơn.

| HTTP | Nghĩa | SMS làm gì |
| --- | --- | --- |
| `200` | Đã nhận, kể cả `boQua` | **DỪNG, không retry** |
| `400` | Payload sai (thân `{error}`) | Sửa payload rồi gửi lại |
| `401` | Sai chữ ký hoặc lệch giờ | Kiểm secret, ký đúng rawBody, đồng bộ đồng hồ |
| `413` | Thân > 8 MB | Rút gọn; **không** chia nhiều lần gửi |
| `503` | MMP chưa cấu hình secret | Báo MEAN, retry sau |
| `500` | Lỗi tạm MMP | Retry có backoff (an toàn vì cùng snapshotId) |

## Phần SMS tự quyết, KHÔNG có trong hợp đồng gốc

1. **`loaiTon` — trường THÊM.** CEO 26/10/2026 yêu cầu MMP thấy rõ loại hàng tồn
   (PO/Return/Cancel/MEAN Design/TQ). Hợp đồng gốc **không có chỗ** cho nó. SMS gửi thêm
   `items[].loaiTon`; **MMP phải nhận và hiện cột này** mới dùng được.
2. **Phạm vi resale** — CEO chốt: `Tồn kho (PO)` · `(Return)` · `(Cancel/ Sai địa chỉ)` ·
   `(MEAN Design)` · `Tồn kho TQ`. **LOẠI `Tồn kho (Consignment)`** — ký gửi, brand vẫn sở
   hữu (đo 26/10: 460 chiếc). Cũng loại `Đồ lỗi (k bán)`, `CompGift`, `Mượn Vendor*`,
   `VTĐG1/2` (vật tư đóng gói), `Retail`.
3. **`ngayNhapKho` suy bằng FIFO** (CEO đồng ý). `warehouse_inventory` chỉ giữ
   `(sku,kho) → số lượng`, không có chiều lô. Nên tiêu thụ tồn hiện tại vào các lô của sổ
   nhập Lark theo **cũ trước, trên MỌI loại**, rồi giữ phần rơi vào lô resale. FIFO trên
   mọi loại là bắt buộc: chỉ FIFO trên lô resale thì tồn ký gửi bị gán sai thành resale.
4. **Trừ `qty_reserved`** — hàng đã hứa cho đơn chưa đóng, không mời bán lại.
5. **`shopifyVariantId` bỏ trống** — MMP ghép theo ID TRƯỚC sku, nên một ID đoán sai là ghép
   vào SẢN PHẨM KHÁC. Để trống thì ghép theo sku, đường hợp đồng đã bảo đảm.

## Còn nợ: đơn SKU đuôi `-sale`

Hợp đồng còn một nửa **chưa làm**: đơn Shopify có dòng SKU `<Global SKU>-sale`, vendor
`MEAN BLVD`. SMS cần (a) bỏ đuôi `-sale` để trừ tồn vào SKU gốc, (b) gửi ảnh chụp theo SKU
gốc — đã đúng, (c) giữ vendor `MEAN BLVD` khi đẩy đơn sang MMP, không tính vào công nợ brand
gốc. Đây là luồng NHẬN ĐƠN, tách khỏi việc đẩy tồn.

## Cách chạy

```bash
# dựng + in, không gửi (mặc định)
railway run --service Shopify-Management-System npx tsx scripts/du-lieu/day-ton-kho-resale-mmp.ts
# gửi thử ảnh nhỏ
... --gioi-han 20 --ap-dung
# gửi thật toàn bộ
... --ap-dung
```
