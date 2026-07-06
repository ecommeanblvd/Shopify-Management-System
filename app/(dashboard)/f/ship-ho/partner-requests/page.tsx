import { desc } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { db, schema } from '@/db/client';
import { RequestRow } from './RequestRow';

export const dynamic = 'force-dynamic';

export default async function PartnerRequestsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_ship_ho')) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center"><h1 className="text-2xl font-semibold">Forbidden</h1></div>;
  }
  const rows = await db.select().from(schema.shipHoPartnerRequests).orderBy(desc(schema.shipHoPartnerRequests.createdAt));
  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Đăng ký ship hộ</h1>
      <div className="border rounded overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40"><tr className="[&>th]:text-left [&>th]:p-2">
            <th>Brand</th><th>Liên hệ</th><th>Trạng thái</th><th>Callback</th><th></th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b [&>td]:p-2 align-top">
                <td className="font-medium">{r.brandSlug}</td>
                <td className="text-muted-foreground">{[r.contactName, r.contactEmail, r.contactPhone].filter(Boolean).join(' · ')}</td>
                <td>{r.status}</td>
                <td className="text-xs">{r.callbackError ? <span className="text-red-600">lỗi: {r.callbackError}</span> : r.callbackSentAt ? 'đã gửi' : '—'}</td>
                <td><RequestRow id={r.id} status={r.status} /></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="p-4 text-center text-muted-foreground">Chưa có đăng ký.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
