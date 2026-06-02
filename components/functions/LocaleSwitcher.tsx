/**
 * Tiny pill-toggle between EN and VI. Pure server component — no
 * client state, no JS. Each option is a Link to the same page with
 * `?lang=` swapped via `withLocale`.
 *
 * The caller passes the full URL path (including current query) so
 * the switcher can preserve unrelated params (e.g. ?shop=…).
 */

import Link from 'next/link';
import { withLocale, type Locale, KNOWN_LOCALES } from '@/features/functions/gift-registry/i18n';

const LABELS: Record<Locale, string> = {
  en: 'EN',
  vi: 'VI',
};

interface LocaleSwitcherProps {
  /** Current full path-and-query, e.g. `/gr/new?shop=mblvd.myshopify.com&lang=en`. */
  currentPath: string;
  current: Locale;
}

export function LocaleSwitcher({ currentPath, current }: LocaleSwitcherProps) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-full bg-white/80 border border-amber-200 text-[11px]">
      {KNOWN_LOCALES.map((locale) => (
        <Link
          key={locale}
          href={withLocale(currentPath, locale)}
          className={
            'px-2.5 py-0.5 rounded-full transition-colors ' +
            (locale === current
              ? 'bg-amber-600 text-white font-semibold'
              : 'text-amber-700/70 hover:text-amber-700')
          }
          aria-current={locale === current ? 'true' : undefined}
        >
          {LABELS[locale]}
        </Link>
      ))}
    </div>
  );
}
