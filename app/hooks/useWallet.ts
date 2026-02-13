import { usePrivy, useWallets } from '@privy-io/react-auth';
import { useEffect, useState } from 'react';
import { WalletState, WalletInfo } from '@/types/database';
import { monadTestnet } from '@/lib/chains';

/**
 * Custom hook for wallet management with Privy
 *
 * Provides:
 * - Wallet connection state
 * - Login/logout methods
 * - Wallet address and chain info
 * - Formatted wallet display data
 */
export function useWallet() {
  const {
    ready,
    authenticated,
    user,
    login,
    logout: privyLogout,
  } = usePrivy();

  const { wallets } = useWallets();
  const [walletState, setWalletState] = useState<WalletState>({
    address: null,
    chainId: null,
    isConnected: false,
    isConnecting: false,
    email: null,
  });

  // Update wallet state when Privy state changes
  useEffect(() => {
    if (!ready) {
      setWalletState((prev) => ({ ...prev, isConnecting: true }));
      return;
    }

    if (authenticated && user) {
      const wallet = wallets[0]; // Primary wallet
      const email = user.email?.address || null;

      setWalletState({
        address: wallet?.address || null,
        chainId: wallet?.chainId ? Number(wallet.chainId) : null,
        isConnected: !!wallet,
        isConnecting: false,
        email,
      });
    } else {
      setWalletState({
        address: null,
        chainId: null,
        isConnected: false,
        isConnecting: false,
        email: null,
      });
    }
  }, [ready, authenticated, user, wallets]);

  // Format address for display (0x1234...5678)
  const formatAddress = (address: string): string => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Get wallet info for display
  const getWalletInfo = (): WalletInfo | null => {
    if (!walletState.address) return null;

    return {
      address: walletState.address,
      shortAddress: formatAddress(walletState.address),
      chainId: walletState.chainId || monadTestnet.id,
      chainName: monadTestnet.name,
    };
  };

  // Connect wallet (trigger Privy login)
  const connect = async () => {
    try {
      setWalletState((prev) => ({ ...prev, isConnecting: true }));
      await login();
    } catch (error) {
      console.error('Wallet connection failed:', error);
      setWalletState((prev) => ({ ...prev, isConnecting: false }));
    }
  };

  // Disconnect wallet
  const disconnect = async () => {
    try {
      await privyLogout();
    } catch (error) {
      console.error('Wallet disconnection failed:', error);
    }
  };

  return {
    // State
    ...walletState,
    ready,

    // Methods
    connect,
    disconnect,
    getWalletInfo,
    formatAddress,

    // Raw Privy data
    user,
    wallets,
  };
}
