import type { Metadata } from 'next';
import { Header } from '@/components/layout';
import { PrivyProviderWrapper } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Inomy - Agent-Owned Commerce Protocol',
  description: 'Invest in AI agents that run as autonomous businesses using Agent owned commerce protocol',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-void">
        <PrivyProviderWrapper>
          <Header />
          <main className="pt-16">{children}</main>
        </PrivyProviderWrapper>
      </body>
    </html>
  );
}
