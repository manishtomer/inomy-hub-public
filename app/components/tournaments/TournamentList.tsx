'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface FantasyTournament {
  id: string;
  name: string;
  status: 'OPEN' | 'ACTIVE' | 'COMPLETED';
  startRound: number | null;
  endRound: number | null;
  teamCount?: number;
  createdAt: string;
  entryFee: number;
  prizePool: number;
}

// Mock preview data
const MOCK_TEAMS = [
  { rank: 1, name: 'Alpha Squad', agents: 'ShopHawk, ReviewBot, CurateMax', score: 0.1247 },
  { rank: 2, name: 'Beta Force', agents: 'DealFinder, TrustAgent, BargainAI', score: 0.0523 },
  { rank: 3, name: 'Gamma Team', agents: 'ShopHawk, DealFinder, TrustAgent', score: -0.0182 },
];

function TournamentPreview() {
  return (
    <div className="space-y-4 mt-6">
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-neutral-800" />
        <span className="text-[10px] text-neutral-600 uppercase tracking-wider">Preview</span>
        <div className="flex-1 h-px bg-neutral-800" />
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-neutral-200 uppercase tracking-wider">
              The Grand Draft
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              3 teams &bull; Rounds 42&ndash;51
            </p>
          </div>
          <Badge variant="active">ACTIVE</Badge>
        </div>
        <div className="mb-4">
          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div className="h-full bg-cyber-500" style={{ width: '60%' }} />
          </div>
        </div>

        <div className="space-y-2">
          {MOCK_TEAMS.map(t => (
            <div key={t.rank} className={`flex items-center justify-between px-3 py-2 rounded ${
              t.rank <= 3 ? 'bg-neutral-800/20' : ''
            }`}>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold w-6 ${
                  t.rank === 1 ? 'text-amber-400' :
                  t.rank === 2 ? 'text-neutral-300' :
                  'text-amber-700'
                }`}>
                  {t.rank}
                </span>
                <div>
                  <div className="text-sm text-neutral-200 font-medium">{t.name}</div>
                  <div className="text-[10px] text-neutral-500">{t.agents}</div>
                </div>
              </div>
              <span className={`text-sm font-mono ${
                t.score >= 0 ? 'text-emerald-500' : 'text-red-400'
              }`}>
                {t.score >= 0 ? '+' : ''}{t.score.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export function TournamentList() {
  const [tournaments, setTournaments] = useState<FantasyTournament[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    async function fetchTournaments() {
      try {
        const [tRes, arenaRes] = await Promise.all([
          fetch('/api/tournaments'),
          fetch('/api/arena/status'),
        ]);
        const json = await tRes.json();
        if (json.success && json.data) {
          setTournaments(json.data);
        }
        const arenaJson = await arenaRes.json().catch(() => ({}));
        if (arenaJson.success && arenaJson.data) {
          setCurrentRound(arenaJson.data.currentRound || 0);
        }
      } catch {
        // Ignore
      } finally {
        setLoading(false);
      }
    }

    fetchTournaments();
    const interval = setInterval(fetchTournaments, 10_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="text-xs text-neutral-500 animate-pulse">Loading tournaments...</div>;
  }

  if (tournaments.length === 0) {
    return (
      <div>
        <div className="border border-dashed border-neutral-700 rounded-lg py-16 px-6">
          <div className="max-w-md mx-auto text-center space-y-4">
            <div className="text-4xl">&#9917;</div>
            <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
              No Tournaments Yet
            </h3>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Fantasy football for AI agents. Draft a team of 3,
              then watch them compete in the real arena.
            </p>
            <div className="grid grid-cols-3 gap-3 pt-2">
              <div className="text-center">
                <div className="text-lg text-cyber-500 font-bold">1</div>
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Create</div>
                <div className="text-[10px] text-neutral-600">Name your tournament</div>
              </div>
              <div className="text-center">
                <div className="text-lg text-cyber-500 font-bold">2</div>
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Draft</div>
                <div className="text-[10px] text-neutral-600">Pick 3 agents</div>
              </div>
              <div className="text-center">
                <div className="text-lg text-cyber-500 font-bold">3</div>
                <div className="text-[10px] text-neutral-500 uppercase tracking-wider">Compete</div>
                <div className="text-[10px] text-neutral-600">10 real rounds</div>
              </div>
            </div>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="text-[10px] text-cyber-500 hover:text-cyber-400 uppercase tracking-wider transition-colors pt-2"
            >
              {showPreview ? 'Hide Preview' : 'See What It Looks Like'}
            </button>
          </div>
        </div>

        {showPreview && <TournamentPreview />}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tournaments.map(t => (
        <Link key={t.id} href={`/tournaments/${t.id}`}>
          <Card hover className="h-full">
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
                {t.name}
              </h3>
              <Badge
                variant={
                  t.status === 'ACTIVE' ? 'active' :
                  t.status === 'COMPLETED' ? 'neutral' :
                  'warning'
                }
              >
                {t.status}
              </Badge>
            </div>

            <div className="space-y-2 text-xs text-neutral-400">
              <div className="flex justify-between">
                <span>Teams</span>
                <span className="text-neutral-300">{t.teamCount || 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Entry</span>
                <span className="text-neutral-300">
                  {t.entryFee > 0 ? `$${t.entryFee.toFixed(2)} USDC` : 'Free'}
                </span>
              </div>
              {t.prizePool > 0 && (
                <div className="flex justify-between">
                  <span>Prize Pool</span>
                  <span className="text-emerald-400 font-mono">${t.prizePool.toFixed(2)}</span>
                </div>
              )}
              {t.startRound && t.endRound && (
                <div className="flex justify-between">
                  <span>Rounds</span>
                  <span className="text-neutral-300">{t.startRound}&ndash;{t.endRound}</span>
                </div>
              )}
            </div>

            {t.status === 'ACTIVE' && t.startRound && t.endRound && (() => {
              const total = t.endRound! - t.startRound! + 1;
              const elapsed = Math.max(0, Math.min(currentRound - t.startRound! + 1, total));
              const pct = Math.round((elapsed / total) * 100);
              return (
                <div className="mt-3">
                  <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                    <div className="h-full bg-cyber-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })()}
          </Card>
        </Link>
      ))}
    </div>
  );
}
