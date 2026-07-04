import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { lookupCarrierGeo, geoRemoteDrift } from '@/features/geo/carrier-geo';
import { GeoLookupView } from './GeoLookupView';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ country?: string; postcode?: string; city?: string }>;
}

export default async function GeoLookupPage({ searchParams }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/sign-in');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'view_carrier_rates')) {
    return (
      <div className="max-w-3xl mx-auto px-6 md:px-10 py-16 text-center space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Forbidden</h1>
        <p className="text-sm text-muted-foreground">You don&rsquo;t have permission to view carrier rates.</p>
      </div>
    );
  }

  const { country, postcode, city } = await searchParams;

  if (country && postcode) {
    const [lookup, drift] = await Promise.all([
      lookupCarrierGeo(country, postcode, city),
      geoRemoteDrift(country),
    ]);
    return (
      <GeoLookupView
        defaultCountry={country}
        defaultPostcode={postcode}
        defaultCity={city ?? ''}
        lookup={lookup}
        drift={drift}
      />
    );
  }

  return (
    <GeoLookupView
      defaultCountry={country ?? ''}
      defaultPostcode={postcode ?? ''}
      defaultCity={city ?? ''}
      lookup={null}
      drift={null}
    />
  );
}
