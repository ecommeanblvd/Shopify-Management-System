import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { UserRound } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { listStoresBasic, getAdminConfig, listAssets } from '@/features/customer-account/admin-queries';
import { DEFAULT_CONFIG } from '@/features/customer-account/config-schema';
import { ConfigEditor } from './ConfigEditor';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ store?: string }>;
}

export default async function CustomerAccountPage({ searchParams }: PageProps): Promise<React.ReactNode> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_functions')) {
    return (
      <div className="px-6 py-16 text-center">
        <h1 className="text-3xl">Forbidden</h1>
      </div>
    );
  }
  const canManage = hasPermission(role, 'manage_functions');

  const stores = await listStoresBasic();
  const sp = await searchParams;
  const activeStoreId = sp.store && stores.some((s) => s.id === sp.store) ? sp.store : stores[0]?.id ?? null;

  const [{ enabled, config }, assets] = activeStoreId
    ? await Promise.all([getAdminConfig(activeStoreId), listAssets(activeStoreId)])
    : [{ enabled: false, config: DEFAULT_CONFIG }, []];

  return (
    <div className="px-6 md:px-10 py-8 md:py-12 space-y-8">
      <header className="space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1.5">
          <UserRound className="size-3.5" />
          Customer Account
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">
          Customer Account Builder
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl">
          Cấu hình trang tài khoản khách hàng cho từng store: bật/tắt, branding
          (logo/hero/announcement), và các module (profile, credit, tracking,
          wishlist, returns). Upload logo/icon dạng PNG nền trong suốt.
        </p>
        <nav className="flex items-center gap-2 pt-1">
          <Link href="/f/customer-account/returns" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Đổi/trả
          </Link>
          <Link href="/f/customer-account/loyalty" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Loyalty
          </Link>
          <Link href="/f/customer-account/hubs" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Return hubs
          </Link>
        </nav>
      </header>

      <ConfigEditor
        stores={stores}
        enabled={enabled}
        config={config}
        assets={assets}
        activeStoreId={activeStoreId}
        canManage={canManage}
      />
    </div>
  );
}
