import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ExternalLink, FileText } from 'lucide-react';
import { docTrangPhuPhi, type DongPhuPhi, type HangTrenTrang } from '@/features/ship-ho/trang-phu-phi/queries';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const t = await docTrangPhuPhi(token);
  // `robots` ở CẢ HAI nhánh: trang mang tên brand và bảng giá hãng, không để máy tìm kiếm lập chỉ mục.
  if (!t) return { title: 'Không tìm thấy', robots: { index: false, follow: false } };
  return { title: `Phụ phí vận chuyển — ${t.tenBrand}`, robots: { index: false, follow: false } };
}

const ngayVn = (d: string) => d.split('-').reverse().join('/');

/** Phạm vi nước của một dòng. Danh sách dài thì gấp lại — `<details>` là HTML thuần, không JS. */
function PhamVi({ nhan, ds }: { nhan: string; ds: string[] }) {
  if (ds.length <= 8) return <span>{nhan}: {ds.join(', ')}</span>;
  return (
    <details>
      <summary className="cursor-pointer">{nhan}: {ds.length} nước đến</summary>
      <span className="block mt-1 break-words">{ds.join(', ')}</span>
    </details>
  );
}

function BangDong({ dong }: { dong: DongPhuPhi[] }) {
  return (
    /* `min-w` là phần thật sự làm việc: thiếu nó thì ở 375px bảng tự co, cột "Cách tính" rơi
       xuống mỗi dòng một chữ, và `overflow-x-auto` không có gì để cuộn. */
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-[15px] border-collapse">
        <thead>
          <tr className="border-b border-neutral-300 text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-4 font-medium">Khoản phụ phí</th>
            <th className="py-2 pr-4 font-medium">Mức</th>
            <th className="py-2 pr-4 font-medium">Cách tính</th>
            <th className="py-2 font-medium whitespace-nowrap">Áp dụng từ</th>
          </tr>
        </thead>
        <tbody>
          {dong.map((d, i) => (
            <tr key={i} className="border-b border-neutral-200 align-top">
              <td className="py-2.5 pr-4">
                <span className="font-medium">{d.nhan}</span>
                {d.tenDong && <span className="block text-sm text-neutral-600">{d.tenDong}</span>}
                {d.mucHang && <span className="block text-sm text-neutral-600">Mức {d.mucHang}</span>}
              </td>
              <td className="py-2.5 pr-4 tabular-nums">{d.giaTri}</td>
              <td className="py-2.5 pr-4 text-sm text-neutral-600">
                {d.cachTinh}
                {d.apDungNuoc && (
                  <span className="block mt-1"><PhamVi nhan="Chỉ áp cho" ds={d.apDungNuoc} /></span>
                )}
                {d.mienNuoc && (
                  <span className="block mt-1"><PhamVi nhan="Miễn" ds={d.mienNuoc} /></span>
                )}
              </td>
              <td className="py-2.5 text-sm text-neutral-600 whitespace-nowrap">
                {d.hieuLucTu ? ngayVn(d.hieuLucTu) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KhoiHang({ h, token }: { h: HangTrenTrang; token: string }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{h.tenHang}</h2>
        {/* Hãng không có trang công bố (Aramex) thì KHÔNG hiện link — một link không dẫn tới
            con số nào thì tệ hơn là không có link. */}
        {h.linkHang && (
          <a
            href={h.linkHang}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"
          >
            Trang công bố của hãng
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
      </div>

      {h.dong.length === 0 && h.tuanDau.length === 0 ? (
        <p className="mt-4 text-[15px] text-neutral-600">Không có phụ phí nào đang áp dụng.</p>
      ) : (
        <>
          {h.dong.length > 0 && <div className="mt-4"><BangDong dong={h.dong} /></div>}

          {h.tuanDau.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Phụ phí xăng dầu theo tuần</h3>
              <p className="mt-1 text-sm text-neutral-600">
                Hãng công bố lại mỗi tuần. Dưới đây là những tuần có đơn của bạn, mới nhất trước.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[260px] text-left text-[15px] border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-300 text-xs uppercase tracking-wide text-neutral-500">
                      <th className="py-2 pr-4 font-medium">Tuần</th>
                      <th className="py-2 font-medium">Mức</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h.tuanDau.map((w) => (
                      <tr key={w.tu} className="border-b border-neutral-200">
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {ngayVn(w.tu)} – {w.den ? ngayVn(w.den) : 'nay'}
                        </td>
                        <td className="py-2 tabular-nums">
                          {w.phanTram.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {h.tep.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">Tài liệu gốc của hãng</h3>
              <ul className="mt-2 space-y-1.5">
                {h.tep.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`/pp/${token}/evidence/${t.id}`}
                      className="inline-flex items-center gap-1.5 text-[15px] text-blue-700 hover:underline"
                    >
                      <FileText className="size-4 shrink-0 text-neutral-400" aria-hidden />
                      {t.label}
                    </a>
                    {(t.tu || t.den) && (
                      <span className="ml-1 text-sm text-neutral-500">
                        ({t.tu ? ngayVn(t.tu) : '…'} – {t.den ? ngayVn(t.den) : 'nay'})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default async function TrangPhuPhiPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await docTrangPhuPhi(token);
  if (!t) notFound();

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Phụ phí vận chuyển — {t.tenBrand}
          </h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-neutral-700">
            Đây là các khoản phụ phí mà hãng vận chuyển thu MEAN BLVD, và MEAN BLVD thu lại đúng số đó
            trên bảng kê của bạn. Mỗi hãng kèm link trang công bố để bạn tự tra, và tài liệu gốc hãng
            phát hành khi có.
          </p>
        </header>

        {t.hang.length === 0 ? (
          <p className="mt-10 rounded-xl border border-neutral-200 bg-white p-6 text-[15px] text-neutral-600">
            Chưa có đơn nào qua SMS nên chưa có phụ phí để dẫn nguồn.
          </p>
        ) : (
          <div className="mt-8 space-y-6">
            {t.hang.map((h) => <KhoiHang key={h.carrierAccountId} h={h} token={token} />)}
          </div>
        )}

        <footer className="mt-10 border-t border-neutral-200 pt-5 text-sm leading-relaxed text-neutral-600">
          Trang này chỉ dẫn nguồn các khoản phụ phí của hãng vận chuyển. Những khoản khác trên bảng kê
          — phí xử lý đơn hàng, thuế và phí nhập khẩu thu hộ — không có nguồn hãng; liên hệ MEAN BLVD
          nếu cần đối chiếu.
        </footer>
      </div>
    </main>
  );
}
