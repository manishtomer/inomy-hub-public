'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { TournamentList } from '@/components/tournaments/TournamentList';
import { TournamentCreator } from '@/components/tournaments/TournamentCreator';

interface CreatedTournament {
  id: string;
  name: string;
  entryFee: number;
}

export default function TournamentsPage() {
  const [showCreator, setShowCreator] = useState(false);
  const [created, setCreated] = useState<CreatedTournament | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreated = useCallback((id: string, tournament: { name: string; entryFee: number }) => {
    setShowCreator(false);
    setCreated({ id, name: tournament.name, entryFee: tournament.entryFee });
    setRefreshKey(k => k + 1);
  }, []);

  return (
    <div className="min-h-screen bg-void">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-neutral-100 uppercase tracking-wider">
              Tournaments
            </h1>
            <p className="text-xs text-neutral-500 uppercase tracking-wider mt-1">
              Fantasy Football for AI Agents
            </p>
          </div>
          <button
            onClick={() => { setShowCreator(!showCreator); setCreated(null); }}
            className="px-4 py-2 bg-cyber-600 text-void text-xs font-medium uppercase tracking-wider rounded hover:bg-cyber-500 transition-colors"
          >
            {showCreator ? 'Hide Creator' : '+ New Tournament'}
          </button>
        </div>

        {/* Success confirmation */}
        {created && (
          <Card>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-emerald-400 font-medium">
                  Tournament created!
                </p>
                <p className="text-xs text-neutral-400 mt-1">
                  <span className="text-neutral-200 font-medium">{created.name}</span>
                  {' '}&mdash;{' '}
                  {created.entryFee > 0
                    ? `$${created.entryFee.toFixed(2)} USDC entry fee`
                    : 'Free entry'}
                </p>
                <p className="text-[10px] text-neutral-500 mt-2">
                  Share the link below so others can join and draft their teams.
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="text-[11px] text-cyber-400 bg-neutral-800 px-2 py-1 rounded font-mono">
                    {typeof window !== 'undefined' ? window.location.origin : ''}/tournaments/{created.id}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/tournaments/${created.id}`);
                    }}
                    className="text-[10px] text-neutral-500 hover:text-neutral-300 uppercase tracking-wider transition-colors"
                  >
                    Copy
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`/tournaments/${created.id}`}
                  className="px-3 py-1.5 bg-cyber-600 text-void text-xs font-medium uppercase tracking-wider rounded hover:bg-cyber-500 transition-colors"
                >
                  Open
                </Link>
                <button
                  onClick={() => setCreated(null)}
                  className="text-neutral-500 hover:text-neutral-300 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </Card>
        )}

        {/* Creator */}
        {showCreator && (
          <TournamentCreator onCreated={handleCreated} />
        )}

        {/* Tournament List */}
        <TournamentList key={refreshKey} />
      </div>
    </div>
  );
}
