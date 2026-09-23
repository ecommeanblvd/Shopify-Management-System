'use client';

/** THUẦN: kẹp số lượng về số nguyên, không dưới `toiThieu`. NaN/Infinity → toiThieu. */
export function kepSoLuong(v: number, toiThieu = 1): number {
  if (!Number.isFinite(v)) return toiThieu;
  return Math.max(toiThieu, Math.round(v));
}

/** Số lượng dạng stepper (−/ô số/+) — spec CEO: "một stepper, không phải ô gõ tự do", chặn dưới ở 1. */
export function Stepper({
  value, onChange, min = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <div className="flex h-9 w-fit items-stretch rounded-md border border-input">
      <button
        type="button"
        aria-label="Giảm số lượng"
        disabled={value <= min}
        onClick={() => onChange(kepSoLuong(value - 1, min))}
        className="flex w-9 shrink-0 cursor-pointer items-center justify-center text-base leading-none disabled:cursor-not-allowed disabled:opacity-40 hover:bg-muted"
      >
        −
      </button>
      <input
        type="number"
        min={min}
        step={1}
        value={value}
        onChange={(e) => onChange(kepSoLuong(Number(e.target.value), min))}
        className="h-full w-14 border-x border-input bg-transparent text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label="Tăng số lượng"
        onClick={() => onChange(kepSoLuong(value + 1, min))}
        className="flex w-9 shrink-0 cursor-pointer items-center justify-center text-base leading-none hover:bg-muted"
      >
        +
      </button>
    </div>
  );
}
