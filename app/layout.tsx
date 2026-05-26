import './globals.css';
import { GeistSans } from 'geist/font/sans';
import { JetBrains_Mono } from 'next/font/google';
import { ThemeProvider } from '@/lib/theme/provider';
import { Toaster } from '@/components/ui/sonner';

// Mono font for code, IDs, currency, and tabular numbers across the system.
// JetBrains Mono + stylistic set 20 (ss20) gives a clean plain zero — no slash,
// no dot — which is what the operator dashboard wants for shipping rates and
// VND amounts (Geist Mono's default slashed zero made amounts hard to read).
const mono = JetBrains_Mono({
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
      className={`${GeistSans.variable} ${mono.variable}`}
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
