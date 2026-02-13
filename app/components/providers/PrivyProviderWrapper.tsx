'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { privyConfig } from '@/lib/privy-config';
import { useGasTopup } from '@/hooks/useGasTopup';

/**
 * Runs inside PrivyProvider so hooks like useWallets() work.
 */
function GasTopupGuard({ children }: { children: React.ReactNode }) {
  useGasTopup();
  return <>{children}</>;
}

/**
 * Privy Provider Wrapper
 *
 * Wraps the app with Privy authentication provider.
 * Must be a client component since Privy uses React hooks.
 */
export function PrivyProviderWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    console.error('NEXT_PUBLIC_PRIVY_APP_ID is not set');
    return <>{children}</>;
  }

  return (
    <PrivyProvider appId={appId} config={privyConfig}>
      <GasTopupGuard>{children}</GasTopupGuard>
    </PrivyProvider>
  );
}
