import { Fragment } from 'react';
import type { DongNhatKy, KhoiNhatKy } from '@/features/nhat-ky/gom-dong';
import { hienNgayGio } from '@/lib/timezone';
import {
  catGiaTri, CHE_HIEN, chipGiaTri, chipThaoTac, hienOThoiGian, kieuTacNhan,
  LY_DO_CHE, NULL_HIEN,
} from './trinh-bay';

/**
 * Bảng nhật ký thay đổi — DÙNG CHUNG cho cả hai lối vào (spec §6): tab "Lịch sử" của một
 * bản ghi, và trang nhật ký cả bảng.
 *
 * Bốn cột đúng theo mẫu lịch sử bản ghi của Lark mà CEO đưa: `Ngày · Người dùng · Trường ·
 * Trước → Sau`. Một KHỐI (cùng người, cùng lúc, cùng bản ghi — `gomKhoi` đã gom) là một
 * nhóm: hai cột đầu dùng `rowSpan` nên đọc ra ngay "lúc 10:03 Đức sửa 3 trường", không
 * phải ba dòng giống nhau.
 *
 * Component THUẦN TRÌNH BÀY: không truy vấn, không gác quyền. Việc che giá trị đã xong ở
 * `che-gia-tri.ts` trước khi dữ liệu tới đây — nên ở đây tuyệt đối không có nhánh nào
 * quyết "có được xem hay không", chỉ có nhánh VẼ cái cờ `biChe` mà tầng dưới đã bật.
 *
 * Không `'use client'`: bảng chỉ đọc, không có tương tác nào. `hienNgayGio` ghim múi giờ
 * Asia/Bangkok nên chữ máy chủ dựng và chữ trình duyệt thấy là một.
 */
export function BangNhatKy({ khoi, banGhiDangMo, trong }: {
  khoi: readonly KhoiNhatKy[];
  /**
   * id bản ghi đang mở, chỉ dùng ở tab "Lịch sử". `nhatKyCuaBanGhi` CUỐN CẢ DÒNG CON, nên
   * một khối có thể là thay đổi của chính bản ghi hoặc của một dòng con — cột "Ngày" ghi rõ
   * khối thuộc về đâu. Bỏ trống (trang cả bảng) thì mọi khối hiện id bản ghi của nó.
   */
  banGhiDangMo?: string;
  /** Chữ khi chưa có thay đổi nào. Mỗi màn nói một câu khác nhau nên để người gọi quyết. */
  trong?: string;
}) {
  if (khoi.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        {trong ?? 'Chưa có thay đổi nào được ghi.'}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
            <th className="w-48">Ngày</th>
            <th className="w-44">Người dùng</th>
            <th className="w-48">Trường</th>
            <th>Trước → Sau</th>
          </tr>
        </thead>
        <tbody>
          {khoi.map((k, iKhoi) => (
            /* Khoá gồm cả chỉ số: khoá gom của `gomKhoi` có thêm TÊN BẢNG mà `KhoiNhatKy`
               không mang, nên hai khối cùng lúc-người-bản ghi ở hai bảng khác nhau vẫn
               phân biệt được ở tầng dưới mà ở đây thì không. */
            <Fragment key={`${k.luc.getTime()}-${k.tacNhanId ?? k.tacNhanNhan}-${k.banGhiId}-${iKhoi}`}>
              {k.dong.map((d, i) => (
                /* Khoá có cả chỉ số: MỘT giao dịch chạy hai lệnh ghi trên cùng một cột
                   (vd `recordQc` ghi hai lần vào một chiếc) sinh hai dòng nhật ký cùng
                   `luc` và cùng `truong` — chúng vào CÙNG một khối, nên khoá chỉ theo tên
                   cột là hai dòng cùng khoá. */
                <tr
                  key={`${d.truong}-${i}`}
                  className={
                    '[&>td]:px-3 [&>td]:py-2 [&>td]:align-top '
                    + (i === 0 ? 'border-t border-border' : 'border-t border-border/40')
                  }
                >
                  {i === 0 && (
                    <>
                      <td rowSpan={k.dong.length} className="whitespace-nowrap text-muted-foreground tabular-nums">
                        {hienNgayGio(k.luc)}
                        <OThaoTac khoi={k} />
                        <ONoiXay khoi={k} banGhiDangMo={banGhiDangMo} />
                      </td>
                      <td rowSpan={k.dong.length}>
                        <ONguoiDung khoi={k} />
                      </td>
                    </>
                  )}
                  <td className="font-medium" title={d.truong}>{d.nhan}</td>
                  <td>
                    <OTruocSau dong={d} />
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Chip THAO TÁC của khối — `them` / `xoa` / `tron`, và không gì cả cho `sua`.
 *
 * Phải có, không được bỏ: trigger ghi một dòng `giá trị → –` cho MỖI cột khi một bản ghi
 * bị xoá, nên một lượt `goChiecNhanNham` (xoá một chiếc nhận nhầm) hiện ra y hệt một người
 * ngồi xoá trắng 35 ô — và chiều ngược lại, một chiếc MỚI vào kho hiện y hệt một người điền
 * vào 35 ô đang trống. Cột "Trước → Sau" không có cách nào phân biệt hai chuyện đó; chỉ
 * `thao_tac` phân biệt được, và tới lượt soát cuối thì không ai ĐỌC cột đó.
 *
 * Nằm dưới cột "Ngày" cùng `ONoiXay` để giữ đúng BỐN cột của mẫu Lark (xem `BangNhatKy`).
 * Luật chọn chip (và vì sao `sua` không có chip) ở `chipThaoTac`.
 */
function OThaoTac({ khoi }: { khoi: KhoiNhatKy }) {
  const chip = chipThaoTac(khoi.thaoTac);
  if (!chip) return null;
  return (
    <span className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-normal ${chip.mau}`}>
      {chip.nhan}
    </span>
  );
}

/**
 * Thay đổi xảy ra ở CHÍNH bản ghi đang mở hay ở một dòng con của nó.
 *
 * Phải nói ra, không được bỏ: tab "Lịch sử" của một lô nhập kho trộn thay đổi của lô với
 * thay đổi của từng chiếc (QC xảy ra ở `goods_receipt_items`) — không phân biệt thì "ai
 * sửa kết quả QC" và "ai sửa thông tin lô" nhìn y như nhau. Giữ đúng BỐN cột của mẫu Lark
 * nên dòng này nằm dưới cột "Ngày" chứ không thành cột thứ năm.
 *
 * Hiện 8 ký tự đầu của uuid: đủ để thấy hai khối là hai chiếc khác nhau, mà không chiếm
 * hết chiều ngang. Nguyên văn nằm ở `title` để copy ra tra tiếp.
 */
function ONoiXay({ khoi, banGhiDangMo }: { khoi: KhoiNhatKy; banGhiDangMo?: string }) {
  if (banGhiDangMo && khoi.banGhiId === banGhiDangMo) {
    return <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">Bản ghi này</span>;
  }
  return (
    <span className="mt-0.5 block font-mono text-[11px] font-normal text-muted-foreground" title={khoi.banGhiId}>
      {banGhiDangMo ? 'Dòng con · ' : ''}{khoi.banGhiId.slice(0, 8)}
    </span>
  );
}

/**
 * Cột "Người dùng" — ba loại tác nhân, ba cách hiện.
 *
 * Mẫu Lark của CEO để tác nhân máy (`Base Assistant`, `Open Claw Bot`) NGANG HÀNG với
 * người, nên nhãn máy hiện cùng cỡ chữ, chỉ thêm một chữ "máy" nhỏ để không ai đi tìm
 * một nhân viên tên "Đồng bộ Lark". Dòng chưa gắn danh tính hiện màu cảnh báo: nó là MÓN
 * NỢ (`demChuaGanDanhTinh` đếm đúng những dòng này), không phải một tác nhân.
 */
function ONguoiDung({ khoi }: { khoi: KhoiNhatKy }) {
  const kieu = kieuTacNhan(khoi);
  if (kieu === 'chua-gan') {
    return (
      <span
        className="text-amber-700 dark:text-amber-400"
        title="Lệnh ghi không đi qua ghiVoi() nên trigger không nhận được danh tính — cron cũ, script, hoặc psql gõ tay."
      >
        {khoi.tacNhanNhan}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="truncate" title={khoi.tacNhanId ?? undefined}>{khoi.tacNhanNhan}</span>
      {kieu === 'may' && (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">máy</span>
      )}
    </span>
  );
}

/**
 * Cột "Trước → Sau".
 *
 * Ô BỊ CHE hiện `•••` KÈM CHỮ nói rõ vì sao (spec §7 cấm ẩn im lặng): không có chữ đó thì
 * ô bị che và ô vốn trống nhìn giống nhau, và người đọc kết luận sai là "không có dữ liệu"
 * thay vì "mình không được xem". `biChe` là MỘT cờ cho cả hai đầu, nên che thì che cả cặp.
 */
function OTruocSau({ dong }: { dong: DongNhatKy }) {
  if (dong.biChe) {
    return (
      <span className="flex flex-wrap items-center gap-2">
        <span className="tracking-widest text-muted-foreground">{CHE_HIEN}</span>
        <Mui />
        <span className="tracking-widest text-muted-foreground">{CHE_HIEN}</span>
        <span className="text-[11px] text-muted-foreground">{LY_DO_CHE}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <OGiaTri truong={dong.truong} gia={dong.truoc} />
      <Mui />
      <OGiaTri truong={dong.truong} gia={dong.sau} />
    </span>
  );
}

/** Mũi "→" của mẫu Lark. `aria-hidden` + chữ cho trình đọc màn hình: một ký tự mũi đọc
 *  thành "mũi tên phải" thì câu "pending mũi tên phải pass" không nói được điều gì. */
function Mui() {
  return (
    <>
      <span aria-hidden className="text-muted-foreground">→</span>
      <span className="sr-only">thành</span>
    </>
  );
}

/** Một đầu của cặp giá trị: chip màu nếu là giá trị dạng chọn, `–` nếu vốn NULL. */
function OGiaTri({ truong, gia }: { truong: string; gia: string | null }) {
  if (gia === null) {
    return <span className="text-muted-foreground" title="Ô này trống">{NULL_HIEN}</span>;
  }
  const chip = chipGiaTri(truong, gia);
  if (chip) {
    return <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${chip.mau}`} title={gia}>{chip.nhan}</span>;
  }
  /* Cột `*_at` ra ISO UTC thô từ `to_jsonb(...) ->> cot`; quy về giờ nghiệp vụ để không
     lệch 7 tiếng so với cột "Ngày" của CHÍNH dòng này. Nguyên văn ở `title` để đối chiếu
     với log hệ thống (vốn theo UTC). Xem `hienOThoiGian`. */
  const moc = hienOThoiGian(truong, gia);
  if (moc) return <span className="whitespace-nowrap tabular-nums" title={gia}>{moc}</span>;
  /* Chuỗi rỗng KHÁC NULL (migration 0210 giữ hai thứ riêng): xoá trắng một ô là một hành
     động của người, nên phải thấy được — hiện chữ thay vì một ô trông như chưa render. */
  if (gia === '') return <span className="text-[11px] italic text-muted-foreground">(để trống)</span>;
  const { hien, daCat } = catGiaTri(gia);
  return (
    <span className="break-all" title={daCat ? gia : undefined}>{hien}{daCat ? '…' : ''}</span>
  );
}
