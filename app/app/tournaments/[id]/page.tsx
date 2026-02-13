'use client';

import { use } from 'react';
import Link from 'next/link';
import { useWallets } from '@privy-io/react-auth';
import { TournamentDetail } from '@/components/tournaments/TournamentDetail';

export default function TournamentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { wallets } = useWallets();
  const connectedWallet = wallets.find(w => w.walletClientType !== 'privy');
  const userWallet = connectedWallet?.address;

  return (
    <div className="min-h-screen bg-void">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Back link */}
        <Link
          href="/tournaments"
          className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider transition-colors"
        >
          &larr; Back to Tournaments
        </Link>

        <TournamentDetail tournamentId={id} userWallet={userWallet} />
      </div>
    </div>
  );
}
