import type { Metadata } from 'next';
import { Inter, Syne, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/contexts/AuthContext';
import AppShell from '@/components/AppShell';
import CookieConsent from '@/components/CookieConsent';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-syne',
  weight: ['700', '800'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['500', '600', '700'],
  display: 'swap',
});

const BASE_URL = 'https://lumidian.ai';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: 'Lumidian — Know when AI mentions your brand',
    template: '%s — Lumidian',
  },
  description: 'Track how ChatGPT, Claude, Perplexity, and Gemini mention your brand. Get a daily visibility score, per-model breakdown, and a shareable pitch deck.',
  keywords: ['AI visibility', 'brand tracking', 'ChatGPT mentions', 'LLM brand monitoring', 'AI search optimization', 'Lumidian'],
  openGraph: {
    type: 'website',
    url: BASE_URL,
    siteName: 'Lumidian',
    title: 'Lumidian — Know when AI mentions your brand',
    description: 'Track how ChatGPT, Claude, Perplexity, and Gemini mention your brand. Daily visibility scores, trend charts, and a shareable pitch deck.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Lumidian — Brand Visibility Tracker' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lumidian — Know when AI mentions your brand',
    description: 'Track how ChatGPT, Claude, Perplexity, and Gemini mention your brand.',
    images: ['/og-image.png'],
  },
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${syne.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-[#0a0a0f] text-[#e2e8f0] antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
        <CookieConsent />
      </body>
    </html>
  );
}
