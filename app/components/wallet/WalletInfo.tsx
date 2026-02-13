'use client';

import { useWallet } from '@/hooks';

/**
 * Wallet Info Display
 *
 * Detailed wallet information component for profile pages or dropdowns.
 * Shows address, chain, balance, and disconnect button.
 */
export function WalletInfo() {
  const { isConnected, getWalletInfo, disconnect, email } = useWallet();

  if (!isConnected) {
    return (
      <div className="p-6 bg-void-light border border-cyber-gold/20 rounded-lg">
        <p className="text-steel-gray text-center">No wallet connected</p>
      </div>
    );
  }

  const walletInfo = getWalletInfo();

  return (
    <div className="p-6 bg-void-light border border-cyber-gold/20 rounded-lg space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-cyber-gold">
          Wallet Connected
        </h3>
        <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
      </div>

      {email && (
        <div className="space-y-1">
          <p className="text-sm text-steel-gray">Email</p>
          <p className="text-white font-mono text-sm break-all">{email}</p>
        </div>
      )}

      {walletInfo && (
        <>
          <div className="space-y-1">
            <p className="text-sm text-steel-gray">Address</p>
            <p className="text-white font-mono text-sm break-all">
              {walletInfo.address}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-steel-gray">Network</p>
            <p className="text-white text-sm">{walletInfo.chainName}</p>
          </div>

          <div className="space-y-1">
            <p className="text-sm text-steel-gray">Chain ID</p>
            <p className="text-white text-sm font-mono">{walletInfo.chainId}</p>
          </div>
        </>
      )}

      <button
        onClick={disconnect}
        className="w-full px-4 py-2 bg-void border border-red-500/50 hover:border-red-500 text-red-500 font-medium rounded-lg transition-colors"
      >
        Disconnect
      </button>
    </div>
  );
}
