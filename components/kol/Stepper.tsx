'use client';

/** THUẦN: kẹp số lượng về số nguyên, không dưới `toiThieu`. NaN/Infinity → toiThieu. */
export function kepSoLuong(v: number, toiThieu = 1): number {
  if (!Number.isFinite(v)) return toiThieu;
  return Math.max(toiThieu, Math.round(v));
}

/** Số lượng dạng stepper (−/ô số/+) — spec CEO: "một stepper, không phải ô gõ tự do", chặn dưới ở 1. */
export function Stepper({
  value, onChange, min = 1, ariaLabel, canhBao = false,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  /** Nhãn cho trình đọc màn hình — bảng có nhiều dòng, "Số lượng" trơn không
   *  phân biệt được dòng nào. */
  ariaLabel?: string;
  /** Vượt tồn kho: viền và số chuyển sang màu cảnh báo (bản thiết kế 24/09).
   *  Màu KHÔNG phải tín hiệu duy nhất — dòng chữ "thiếu {n}" ở ô sản phẩm mới
   *  là chỗ nói rõ, để người không phân biệt được màu vẫn đọc ra. */
  canhBao?: boolean;
}) {
  return (
    <div className={`flex h-[34px] w-fit items-stretch rounded-lg border ${canhBao ? 'border-amber-500/60' : 'border-input'}`}>
      <button
        type="button"
        aria-label="Giảm số lượng"
        disabled={value <= min}
        onClick={() => onChange(kepSoLuong(value - 1, min))}
        className="flex w-[30px] shrink-0 cursor-pointer items-center justify-center text-base leading-none hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        step={1}
        value={value}
        onChange={(e) => onChange(kepSoLuong(Number(e.target.value), min))}
        aria-label={ariaLabel}
        className={`h-full w-12 border-x bg-transparent text-center text-sm font-semibold tabular-nums outline-none ${canhBao ? 'border-amber-500/60 text-amber-600 dark:text-amber-400' : 'border-input'} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
      <button
        type="button"
        aria-label="Tăng số lượng"
        onClick={() => onChange(kepSoLuong(value + 1, min))}
        className="flex w-[30px] shrink-0 cursor-pointer items-center justify-center text-base leading-none hover:bg-muted"
      >
        +
      </button>
    </div>
  );
}
