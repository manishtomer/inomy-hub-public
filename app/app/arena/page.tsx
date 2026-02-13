'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useWallets } from '@privy-io/react-auth';
import { ArenaControls } from '@/components/arena/ArenaControls';
import { SeasonLeaderboard } from '@/components/arena/SeasonLeaderboard';
import { LiveRoundFeed } from '@/components/arena/LiveRoundFeed';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { AuctionRoundsTable } from '@/components/dashboard/AuctionRoundsTable';
import { TournamentList } from '@/components/tournaments/TournamentList';
import { TournamentCreator } from '@/components/tournaments/TournamentCreator';
import { Card } from '@/components/ui/Card';
import { useArena } from '@/hooks/useArena';

type ArenaTab = 'season' | 'tournaments';

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-neutral-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 bg-surface hover:bg-elevated/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-neutral-300 uppercase tracking-wider">
            {title}
          </span>
          {badge && (
            <span className="text-[10px] text-neutral-500 font-mono">{badge}</span>
          )}
        </div>
        <ChevronDown open={open} />
      </button>
      {open && (
        <div className="[&>*]:border-0 [&>*]:rounded-none">
          {children}
        </div>
      )}
    </div>
  );
}

interface CreatedTournament {
  id: string;
  name: string;
  entryFee: number;
}

export default function ArenaPage() {
  const arena = useArena();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address;
  const runRoundsWithWallet = useCallback(
    (count: number) => arena.runRounds(count, connectedWallet),
    [arena.runRounds, connectedWallet]
  );
  const [tab, setTab] = useState<ArenaTab>('season');
  const [showCreator, setShowCreator] = useState(false);
  const [created, setCreated] = useState<CreatedTournament | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleTournamentCreated = useCallback((id: string, tournament: { name: string; entryFee: number }) => {
    setShowCreator(false);
    setCreated({ id, name: tournament.name, entryFee: tournament.entryFee });
    setRefreshKey(k => k + 1);
  }, []);

  const season = arena.state?.season || null;
  const currentRound = arena.state?.currentRound || 0;
  const seasonTotal = season?.roundsTotal || 10;
  const computedSeasonNumber = currentRound > 0
    ? Math.floor((currentRound - 1) / seasonTotal) + 1
    : 0;
  const roundInSeason = currentRound > 0
    ? ((currentRound - 1) % seasonTotal) + 1
    : 0;
  const roundsRemaining = Math.max(seasonTotal - roundInSeason, 0);

  return (
    <div className="min-h-screen bg-void">
      {/* Sticky HUD: tabs + season info + controls */}
      <div className="sticky top-14 z-30 bg-void/95 backdrop-blur-sm border-b border-neutral-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-between gap-4">
          {/* Left: Tabs + Season context */}
          <div className="flex items-center gap-4">
            {/* Tabs */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setTab('season')}
                className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors rounded ${
                  tab === 'season'
                    ? 'text-cyber-500 bg-neutral-800/50'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Season
              </button>
              <button
                onClick={() => setTab('tournaments')}
                className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wider transition-colors rounded ${
                  tab === 'tournaments'
                    ? 'text-cyber-500 bg-neutral-800/50'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Tournaments
              </button>
            </div>

            {/* Season context inline */}
            {tab === 'season' && season && (
              <div className="hidden sm:flex items-center gap-2 text-[11px] text-neutral-500">
                <span className="w-px h-3 bg-neutral-700" />
                <span className="text-neutral-300 font-medium">
                  Season {computedSeasonNumber}
                </span>
                <span>&middot;</span>
                <span>{roundsRemaining} rounds left</span>
              </div>
            )}
          </div>

          {/* Right: Controls */}
          {tab === 'season' && arena.state && (
            <ArenaControls
              state={arena.state}
              isRunning={arena.isRunning}
              onRunRounds={runRoundsWithWallet}
              onToggleAutoRun={arena.toggleAutoRun}
              onSetSpeed={arena.setSpeed}
              error={arena.error}
              walletConnected={!!connectedWallet}
            />
          )}

          {tab === 'tournaments' && (
            <button
              onClick={() => { setShowCreator(!showCreator); setCreated(null); }}
              className="px-4 py-1.5 bg-cyber-600 text-void text-xs font-medium uppercase tracking-wider rounded hover:bg-cyber-500 transition-colors"
            >
              {showCreator ? 'Cancel' : '+ New Tournament'}
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {tab === 'season' && (
          <div className="space-y-6">
            {/* === ZONE 1: THE MATCH (leaderboard + live feed) === */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-3">
                <SeasonLeaderboard seasonId={arena.state?.season?.id} />
              </div>
              <div className="lg:col-span-2">
                <LiveRoundFeed lastResult={arena.lastResult} />
              </div>
            </div>

            {/* === ZONE 3: DEEP DIVE (collapsible) === */}
            <CollapsibleSection title="Live Activity" defaultOpen={false}>
              <div className="p-0">
                <ActivityFeed />
              </div>
            </CollapsibleSection>

            <CollapsibleSection title="Auction Rounds" defaultOpen={false}>
              <div className="p-0">
                <AuctionRoundsTable />
              </div>
            </CollapsibleSection>

          </div>
        )}

        {tab === 'tournaments' && (
          <div className="space-y-4">
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
                      Share the link so others can join and draft their teams.
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="text-[11px] text-cyber-400 bg-neutral-800 px-2 py-1 rounded font-mono">
                        {typeof window !== 'undefined' ? window.location.origin : ''}/tournaments/{created.id}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(`${window.location.origin}/tournaments/${created.id}`)}
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

            {showCreator && (
              <TournamentCreator onCreated={handleTournamentCreated} />
            )}
            <TournamentList key={refreshKey} />
          </div>
        )}
      </div>
    </div>
  );
}
