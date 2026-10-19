"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

/**
 * KHAI "đang có thay đổi chưa lưu" từ bên trong hộp thoại.
 *
 * Bấm ra ngoài hộp thoại vốn ĐÃ đóng nó (Base UI `disablePointerDismissal` mặc định `false`)
 * — và đó là đúng ý CEO: không có gì đang sửa thì bấm ra ngoài là tắt, nhanh gọn. Nhưng khi
 * đang gõ dở thì một cú bấm trượt làm bay hết chữ, không hoàn lại được. Đã xảy ra thật với
 * Đức ở modal đối soát (14/10/2026).
 *
 * Vì sao khai TAY chứ không tự dò các ô `input` trong hộp: dò tự động thì hoặc hỏi thừa (ô
 * điền sẵn bị React vẽ lại cũng tính là "đã đổi") — hỏng đúng cái CEO muốn là "không có thay
 * đổi thì cứ tắt" — hoặc bỏ sót với ô không phải `input` (chọn box, chọn ảnh, danh sách).
 * Một dòng khai ở nơi biết rõ mình có gì chưa lưu thì đúng, và hộp thoại nào chưa khai vẫn
 * chạy y như trước.
 */
type DatChuaLuu = (co: boolean) => void
const NgCanhChuaLuu = React.createContext<DatChuaLuu | null>(null)

/** Gọi trong hộp thoại: `coThayDoi` đúng khi có thứ chưa lưu sẽ mất nếu đóng bây giờ. */
function useChuaLuu(coThayDoi: boolean) {
  const dat = React.useContext(NgCanhChuaLuu)
  React.useEffect(() => {
    dat?.(coThayDoi)
    // Rời khỏi cây (hộp thoại đóng/đổi nội dung) thì KHÔNG để lại cờ bẩn — lượt mở sau sẽ
    // hỏi một câu vô duyên và người dùng mất tin vào cảnh báo.
    return () => dat?.(false)
  }, [dat, coThayDoi])
}

/**
 * Thẻ khai "đang có thay đổi chưa lưu", đặt BÊN TRONG `DialogContent`.
 *
 * Phải là một thẻ con chứ không gọi `useChuaLuu` thẳng ở component dựng `<Dialog>`: ngữ cảnh
 * React đọc từ provider Ở TRÊN, mà component đó nằm trên `<Dialog>` nên sẽ đọc ra `null` và
 * cảnh báo im lặng không bao giờ chạy — hỏng kiểu không ai thấy.
 */
function KhaiChuaLuu({ co }: { co: boolean }) {
  useChuaLuu(co)
  return null
}

function Dialog({ onOpenChange, children, ...props }: DialogPrimitive.Root.Props) {
  const chuaLuu = React.useRef(false)
  const [hoi, setHoi] = React.useState(false)
  const thaoTac = React.useRef<DialogPrimitive.Root.Actions | null>(null)
  const dat = React.useCallback<DatChuaLuu>((co) => { chuaLuu.current = co }, [])

  const xuLyDong = React.useCallback(
    (open: boolean, chiTiet: DialogPrimitive.Root.ChangeEventDetails) => {
      /* `imperative-action` là lượt đóng do CHÍNH ta gọi sau khi người dùng đã xác nhận bỏ —
       * chặn nó nữa thì thành vòng lặp không bao giờ đóng được. */
      if (!open && chuaLuu.current && chiTiet.reason !== "imperative-action") {
        chiTiet.cancel()
        setHoi(true)
        return
      }
      onOpenChange?.(open, chiTiet)
    },
    [onOpenChange]
  )

  /* `children` của Base UI còn có thể là HÀM dựng (dạng payload). Không chen câu hỏi vào ca
   * đó — chen là vỡ kiểu, mà hộp thoại dạng hàm cũng không dùng `useChuaLuu`. */
  const noiDung: DialogPrimitive.Root.Props["children"] =
    typeof children === "function" ? (
      children
    ) : (
      <>
        {children}
        <HoiBoThayDoi
          mo={hoi}
          doiMo={setHoi}
          onBo={() => {
            chuaLuu.current = false
            setHoi(false)
            thaoTac.current?.close()
          }}
        />
      </>
    )

  return (
    <NgCanhChuaLuu.Provider value={dat}>
      <DialogPrimitive.Root
        data-slot="dialog"
        actionsRef={thaoTac}
        onOpenChange={xuLyDong}
        {...props}
      >
        {noiDung}
      </DialogPrimitive.Root>
    </NgCanhChuaLuu.Provider>
  )
}

/**
 * Hỏi lại trước khi bỏ thay đổi. Nằm TRONG `Dialog.Root` cha để Base UI biết đây là hộp thoại
 * lồng và nhường bẫy tiêu điểm; dựng ngoài thì hộp cha giữ tiêu điểm và không bấm được nút nào.
 *
 * Lớp phủ/hộp dùng z-[70]/z-[80] — phải TRÊN hộp cha (z-50/z-[60]), nếu không câu hỏi nằm dưới
 * chính cái hộp nó đang hỏi về.
 */
function HoiBoThayDoi({
  mo, doiMo, onBo,
}: { mo: boolean; doiMo: (v: boolean) => void; onBo: () => void }) {
  return (
    <DialogPrimitive.Root open={mo} onOpenChange={doiMo}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-[70] bg-black/20 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup className="fixed top-1/2 left-1/2 z-[80] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-3 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none sm:max-w-sm">
          <DialogPrimitive.Title className="text-base leading-none font-medium">
            Đóng mà chưa lưu?
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-muted-foreground">
            Có thay đổi chưa được lưu. Đóng bây giờ là mất, không lấy lại được.
          </DialogPrimitive.Description>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => doiMo(false)}>
              Ở lại, tiếp tục sửa
            </Button>
            <Button variant="destructive" onClick={onBo}>
              Đóng và bỏ thay đổi
            </Button>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

/**
 * Lớp phủ PHẢI thấp hơn hộp thoại (14/10/2026 — Đức báo modal đối soát tắt khi gõ hoặc khi
 * click bất kỳ đâu).
 *
 * Trước đây cả hai cùng `z-50` và lớp phủ còn `isolate` (tạo ngữ cảnh xếp lớp riêng): thứ tự
 * chỉ còn dựa vào vị trí trong DOM — một thế hoà. Hoà mà nghiêng sai bên thì lớp phủ nằm
 * trên, mọi cú click kể cả click vào ô nhập đều rơi vào lớp phủ, và thư viện đóng hộp thoại.
 * Nay lớp phủ `z-50`, hộp thoại `z-[60]`: thứ tự đúng theo cấu trúc, không phụ thuộc DOM.
 * `isolate` bỏ đi vì nó không phục vụ gì cho một lớp phủ phủ kín màn hình.
 */
function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Hộp thoại nào ĐỂ CHÍNH NÓ cuộn (truyền `overflow-y-auto`/`overflow-auto` vào `className`)?
 *
 * Phải biết, vì nút đóng là `absolute` bên trong hộp: khi chính hộp là vùng cuộn thì phần tử
 * `absolute` cuộn THEO nội dung, nên kéo xuống một đoạn là nút X biến mất và người dùng không
 * còn cách nào đóng bằng chuột (Bảo báo 19/10/2026 — "để trong box lúc kéo xuống thì mất dấu
 * x không ấn được", gặp ở MỌI hộp thoại loại này; đếm được 17 chỗ).
 *
 * Nhận bằng chuỗi `className` nghe thô, nhưng đó đúng là nơi 132 chỗ gọi khai ý định cuộn, và
 * đổi hết 132 chỗ để thêm một cờ là đổi nhiều thứ không cần đổi. Chỗ nào KHÔNG khai cuộn thì
 * giữ nguyên cấu trúc cũ — nhiều hộp thoại tự dựng bố cục flex với thanh nút dính đáy và
 * trông chờ con của chúng là con TRỰC TIẾP của popup (xem HopThoaiXacNhanVanDon).
 */
const RE_TU_CUON = /\boverflow-(y-)?auto\b/
/** Hộp thoại tự CẮT nội dung (`overflow-hidden`) — chúng tự dựng bố cục cuộn bên trong, và
 *  nút đóng nằm ngoài mép sẽ BỊ CẮT MẤT, nên những hộp này giữ nút ở trong. */
const RE_TU_CAT = /\boverflow-hidden\b/

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  const lop = typeof className === "string" ? className : ""
  const tuCuon = RE_TU_CUON.test(lop)
  const tuCat = RE_TU_CAT.test(lop)
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-[60] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
          /* Chuyển việc cuộn XUỐNG lớp trong, trả popup về không-cuộn. Đặt SAU `className` để
           * thắng `overflow-y-auto` của chỗ gọi (tailwind-merge lấy lớp sau cùng).
           *
           * `flex flex-col` chứ KHÔNG giữ `grid`: đã dựng trang thử và đo bằng mắt — với
           * `grid`, ô lưới không co lại dưới chiều cao nội dung nên `max-h` của chỗ gọi mất
           * tác dụng và nội dung TRÀN RA NGOÀI hộp thay vì sinh thanh cuộn. Flex thì ép đúng.
           *
           * `overflow-visible` chứ không `hidden`: nút đóng nay nằm NGOÀI mép hộp. */
          tuCuon && "flex flex-col overflow-visible"
        )}
        {...props}
      >
        {tuCuon ? (
          /* `min-h-0` BẮT BUỘC (mặc định `min-height: auto` không co được dưới chiều cao nội
           * dung). Giữ `grid gap-4` ở ĐÂY để các con vẫn cách nhau đúng như khi chúng còn là
           * con trực tiếp của popup — nếu không, 17 hộp thoại mất hết khoảng cách. */
          <div data-slot="dialog-scroll" className="grid min-h-0 flex-1 gap-4 overflow-y-auto">
            {children}
          </div>
        ) : (
          children
        )}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                /* NGOÀI mép hộp, như Bảo xin (19/10/2026): nút không còn đè lên tiêu đề, và
                 * vì nằm ngoài lớp cuộn nên kéo bao nhiêu cũng không mất. Nền đặc + viền để
                 * đọc được trên mọi nền phía sau; lệch 0,75rem, vẫn nằm trong lề 1rem của
                 * `max-w-[calc(100%-2rem)]` nên màn hình hẹp không bị đẩy khỏi khung nhìn.
                 *
                 * Hộp thoại tự cắt (`overflow-hidden`, vd HopThoaiXacNhanVanDon) thì GIỮ nút
                 * ở trong — ra ngoài là bị cắt mất, thành đúng cái lỗi đang sửa. Những hộp đó
                 * tự dựng vùng cuộn riêng nên nút vốn đã không bị cuộn theo. */
                className={cn(
                  "z-10 absolute rounded-full bg-popover text-foreground shadow-sm ring-1 ring-foreground/15 hover:bg-muted",
                  tuCat ? "top-2 right-2" : "-top-3 -right-3"
                )}
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Đóng</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  KhaiChuaLuu,
  useChuaLuu,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
