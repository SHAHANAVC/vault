import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Vault — Family Cash Flow Management Platform',
  description: 'Private, collaborative family cash-flow and bucket financial manager.',
};

/**
 * Server Component (Default in App Router)
 * Renders static HTML structure on the server with zero client-side JavaScript.
 */
import { AppProviders } from '../providers/AppProviders';

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground selection:bg-primary/20 selection:text-primary">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
