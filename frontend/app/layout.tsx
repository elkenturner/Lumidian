import type { Metadata, Viewport } from 'next';
import { Inter, Geist_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import AppShell from '@/components/AppShell';
import CookieConsent from '@/components/CookieConsent';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

// Display face for headings — technical/geometric, pairs with Inter + Geist
// Mono into one family. Exposed as --font-display; --font-syne aliases to it
// in globals.css so existing references pick it up.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['500', '600', '700'],
  display: 'swap',
});

const BASE_URL = 'https://lumidian.ai';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Lumidian · Know when AI mentions your brand',
    template: '%s · Lumidian',
  },
  description: 'Track how ChatGPT, Claude, Perplexity, and Gemini mention your brand. Get a daily visibility score, per-model breakdown, and a shareable pitch deck.',
  keywords: ['AI visibility', 'brand tracking', 'ChatGPT mentions', 'LLM brand monitoring', 'AI search optimization', 'Lumidian'],
  openGraph: {
    type: 'website',
    url: BASE_URL,
    siteName: 'Lumidian',
    title: 'Lumidian · Know when AI mentions your brand',
    description: 'Track how ChatGPT, Claude, Perplexity, and Gemini mention your brand. Daily visibility scores, trend charts, and a shareable pitch deck.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Lumidian · Brand Visibility Tracker' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lumidian · Know when AI mentions your brand',
    description: 'Track how ChatGPT, Claude, Perplexity, and Gemini mention your brand.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: [
      { url: '/favicon-light.png', media: '(prefers-color-scheme: light)' },
      { url: '/favicon-dark.png', media: '(prefers-color-scheme: dark)' },
    ],
    shortcut: '/favicon-light.png',
    apple: '/favicon-light.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} ${spaceGrotesk.variable}`}>
      <body suppressHydrationWarning className="bg-[var(--bg-base)] text-[var(--text-primary)] antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
        <CookieConsent />
      </body>
    </html>
  );
}
