import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { themeInitScript } from '@/components/theme-toggle';
import { AuthProvider } from '@/lib/auth';
import './globals.css';

export const metadata: Metadata = {
  title: 'PropForce AI',
  description: 'AI-powered real estate brokerage operating system for UAE agencies.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
