'use client';

import { usePrivy } from '@privy-io/react-auth';
import { getExplorerAddressUrl } from '@/lib/contracts';
import type { Address } from 'viem';

/**
 * Wallet Connect Button
 *
 * Primary button for connecting/disconnecting wallet.
 * Uses Privy directly for reliability.
 */
export function ConnectButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  // Format address for display
  const formatAddress = (address: string): string => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Not ready yet - show loading state
  if (!ready) {
    return (
      <button
        disabled
        className="px-4 py-2 bg-cyber-500/50 border border-cyber-500 rounded text-white text-xs uppercase tracking-wider cursor-wait animate-pulse"
      >
        Loading...
      </button>
    );
  }

  // Authenticated - show user info and logout
  if (authenticated && user) {
    const walletAddress = user.wallet?.address;
    const email = user.email?.address;
    const displayText = walletAddress
      ? formatAddress(walletAddress)
      : email
        ? email.slice(0, 15) + (email.length > 15 ? '...' : '')
        : 'Connected';

    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-800 border border-cyber-500 rounded">
          <div className="w-2 h-2 bg-emerald-500 rounded-full" />
          {walletAddress ? (
            <a
              href={getExplorerAddressUrl(walletAddress as Address)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyber-500 text-xs font-mono hover:text-cyber-400 transition-colors"
            >
              {displayText}
            </a>
          ) : (
            <span className="text-cyber-500 text-xs font-mono">
              {displayText}
            </span>
          )}
        </div>
        <button
          onClick={logout}
          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded text-neutral-400 hover:text-neutral-200 text-xs uppercase tracking-wider transition-colors"
        >
          Logout
        </button>
      </div>
    );
  }

  // Not authenticated - show connect button
  return (
    <button
      onClick={login}
      className="px-4 py-2 bg-cyber-500 hover:bg-cyber-600 text-void font-medium rounded text-xs uppercase tracking-wider transition-colors"
    >
      Connect
    </button>
  );
}
