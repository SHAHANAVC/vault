import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Vault — Family Cash Flow Management Platform',
  description: 'Private, collaborative family cash-flow and bucket financial manager.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#F7F8FA' },
    { media: '(prefers-color-scheme: dark)', color: '#0B0F14' },
  ],
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
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col bg-background text-foreground selection:bg-primary/20 selection:text-primary">
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
