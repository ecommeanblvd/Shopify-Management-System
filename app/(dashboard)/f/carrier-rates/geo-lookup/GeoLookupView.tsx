'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, MapPin, AlertTriangle, CheckCircle2, HelpCircle, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { buttonVariants } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CarrierGeoLookup, CarrierGeoRow } from '@/features/geo/carrier-geo';

interface Props {
  defaultCountry: string;
  defaultPostcode: string;
  defaultCity: string;
  lookup: CarrierGeoLookup | null;
  drift: { checked: number; missing: string[] } | null;
}

export function GeoLookupView({ defaultCountry, defaultPostcode, defaultCity, lookup, drift }: Props) {
  const router = useRouter();
  const [country, setCountry] = useState(defaultCountry);
  const [postcode, setPostcode] = useState(defaultPostcode);
  const [city, setCity] = useState(defaultCity);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!country.trim() || !postcode.trim()) return;
    const params = new URLSearchParams({ country: country.trim(), postcode: postcode.trim() });
    if (city.trim()) params.set('city', city.trim());
    router.push(`/f/carrier-rates/geo-lookup?${params.toString()}`);
  }

  return (
    <div className="px-6 md:px-10 py-10 space-y-8">
      {/* Breadcrumb */}
      <div className="space-y-3">
        <Link
          href="/f/carrier-rates"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" /> Carrier rates
        </Link>
        <div className="flex items-center gap-2">
          <MapPin className="size-6" />
          <h1 className="text-3xl font-semibold tracking-tight">Tra cứu geo</h1>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Nhập mã nước + bưu chính để xem geo master (city/state) và zone + remote tier
          của từng carrier account.
        </p>
      </div>

      {/* Search form */}
      <Card>
        <CardContent className="pt-4">
          <form onSubmit={handleSubmit} method="GET" action="/f/carrier-rates/geo-lookup">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1 flex-1 min-w-[100px]">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider" htmlFor="geo-country">
                  Mã nước *
                </label>
                <Input
                  id="geo-country"
                  name="country"
                  placeholder="VN / AU / US…"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="uppercase"
                  maxLength={2}
                  required
                />
              </div>
              <div className="space-y-1 flex-1 min-w-[120px]">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider" htmlFor="geo-postcode">
                  Bưu chính *
                </label>
                <Input
                  id="geo-postcode"
                  name="postcode"
                  placeholder="70000 / 2000…"
                  value={postcode}
                  onChange={(e) => setPostcode(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1 flex-[2] min-w-[140px]">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider" htmlFor="geo-city">
                  Thành phố (tuỳ chọn)
                </label>
                <Input
                  id="geo-city"
                  name="city"
                  placeholder="Ho Chi Minh…"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className={buttonVariants() + ' gap-1.5 h-8 px-4 shrink-0'}
              >
                <Search className="size-4" />
                Tra cứu
              </button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Results */}
      {lookup && (
        <div className="space-y-6">
          {/* Geo master */}
          <GeoMasterCard geo={lookup.geo} />

          {/* Drift badge */}
          {drift && drift.missing.length > 0 && (
            <DriftAlert drift={drift} />
          )}

          {/* Carrier table */}
          <CarrierTable carriers={lookup.carriers} />
        </div>
      )}

      {!lookup && defaultCountry && defaultPostcode && (
        <div className="text-sm text-muted-foreground text-center py-8">
          Không có kết quả.
        </div>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

function GeoMasterCard({ geo }: { geo: CarrierGeoLookup['geo'] }) {
  const { valid, city, stateCode } = geo;

  let icon: React.ReactNode;
  let label: string;
  let badgeVariant: 'default' | 'outline' | 'secondary' | 'destructive';

  if (valid === null) {
    icon = <HelpCircle className="size-4 text-muted-foreground" />;
    label = '— Chưa nạp dữ liệu geo';
    badgeVariant = 'outline';
  } else if (valid) {
    icon = <CheckCircle2 className="size-4 text-emerald-500" />;
    label = '✓ Hợp lệ';
    badgeVariant = 'secondary';
  } else {
    icon = <AlertTriangle className="size-4 text-amber-500" />;
    label = '⚠ Không tìm thấy';
    badgeVariant = 'destructive';
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Geo master</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            {icon}
            <Badge variant={badgeVariant} className="h-6 px-2 text-xs">
              {label}
            </Badge>
          </div>
          {city && (
            <div className="text-sm">
              <span className="text-muted-foreground">City: </span>
              <span className="font-medium">{city}</span>
            </div>
          )}
          {stateCode && (
            <div className="text-sm">
              <span className="text-muted-foreground">State: </span>
              <span className="font-medium font-mono">{stateCode}</span>
            </div>
          )}
          {valid === null && (
            <p className="text-xs text-muted-foreground">
              Nước này chưa được nạp vào geo master — không thể xác thực bưu chính.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DriftAlert({ drift }: { drift: { checked: number; missing: string[] } }) {
  const shown = drift.missing.slice(0, 20);
  const more = drift.missing.length - shown.length;
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-5 py-4 space-y-2">
      <div className="flex items-center gap-2 font-medium text-sm text-amber-700 dark:text-amber-400">
        <AlertTriangle className="size-4 shrink-0" />
        {drift.missing.length} bưu chính trong remote-list không có trong geo master (nghi lỗi thời)
      </div>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((p) => (
          <span
            key={p}
            className="inline-block font-mono text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded px-1.5 py-0.5"
          >
            {p}
          </span>
        ))}
        {more > 0 && (
          <span className="text-xs text-amber-600 dark:text-amber-400 self-center">
            +{more} khác…
          </span>
        )}
      </div>
      <p className="text-xs text-amber-600 dark:text-amber-500">
        Đã kiểm {drift.checked} pattern postcode.
      </p>
    </div>
  );
}

function matchedByLabel(matchedBy: CarrierGeoRow['matchedBy']): string {
  switch (matchedBy) {
    case 'postcode': return 'Bưu chính';
    case 'city': return 'Thành phố';
    case 'country_default': return 'Mặc định nước';
    default: return '—';
  }
}

function CarrierTable({ carriers }: { carriers: CarrierGeoRow[] }) {
  if (carriers.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Không có carrier account nào.
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Carrier accounts</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Account</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Zone</TableHead>
              <TableHead>Remote tier</TableHead>
              <TableHead>Khớp bởi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {carriers.map((row) => (
              <TableRow key={row.accountId}>
                <TableCell className="font-medium">{row.accountName}</TableCell>
                <TableCell>
                  {row.carrierKey ? (
                    <span className="font-mono text-xs text-muted-foreground uppercase">
                      {row.carrierKey}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.zone ? (
                    <Badge variant="secondary" className="font-mono text-xs h-5">
                      {row.zone}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {row.tier ? (
                    <Badge variant="default" className="text-xs h-5">
                      {row.tier}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">Không remote</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className={row.matchedBy ? 'text-xs text-foreground' : 'text-xs text-muted-foreground'}>
                    {matchedByLabel(row.matchedBy)}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
