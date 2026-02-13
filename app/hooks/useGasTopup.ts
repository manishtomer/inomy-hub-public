'use client';

import { useEffect, useRef } from 'react';
import { useWallets } from '@privy-io/react-auth';

/**
 * Auto-tops up the connected user wallet with 0.5 MON if balance is low.
 * Runs once per session (per wallet address) on wallet connect.
 */
export function useGasTopup() {
  const { wallets } = useWallets();
  const checkedRef = useRef<Set<string>>(new Set());

  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy');
  const address = connectedWallet?.address;

  useEffect(() => {
    if (!address) return;
    if (checkedRef.current.has(address)) return;

    // Mark as checked immediately to prevent double-fires
    checkedRef.current.add(address);

    fetch('/api/gas-topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet: address }),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data.topped_up > 0) {
          console.log(`[Gas] Topped up ${address.slice(0, 10)}... with 0.5 MON`);
        }
      })
      .catch(() => {
        // Silent fail — gas top-up is best-effort
      });
  }, [address]);
}
