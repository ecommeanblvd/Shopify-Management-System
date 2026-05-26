import './globals.css';
import { GeistSans } from 'geist/font/sans';
import { Inter } from 'next/font/google';
import { ThemeProvider } from '@/lib/theme/provider';
import { Toaster } from '@/components/ui/sonner';

// Number / "mono-slot" font used by .font-mono and .tabular-nums.
// Inter is a sans-serif UI font with a fully plain zero (no slash, no dot)
// and proper tabular figures via the `tnum` OpenType feature — so currency,
// weight tiers, and percentages line up in columns without the slashed-0
// problem of Geist Mono / JetBrains Mono. We pull the entire variable
// weight axis so headings and emphasis still work crisply.
const numFont = Inter({
  subsets: ['latin'],
  variable: '--font-mono-raw',
  display: 'swap',
});

export const metadata = {
  title: 'Shopify Management',
  description: 'Central management for multiple Shopify stores',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${numFont.variable}`}
    >
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
