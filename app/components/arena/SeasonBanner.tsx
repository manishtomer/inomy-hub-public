'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';

interface SeasonInfo {
  id: string;
  seasonNumber: number;
  startRound: number;
  endRound: number | null;
  status: 'ACTIVE' | 'COMPLETED';
  championAgentId: string | null;
  roundsCompleted: number;
  roundsTotal: number;
}

interface ChampionInfo {
  id: string;
  name: string;
  score: number;
}

interface SeasonBannerProps {
  season: SeasonInfo | null;
  currentRound: number;
}

export function SeasonBanner({ season, currentRound }: SeasonBannerProps) {
  const [lastChampion, setLastChampion] = useState<{
    seasonNumber: number;
    champion: ChampionInfo;
  } | null>(null);

  // Fetch last completed season champion
  useEffect(() => {
    async function fetchLastSeason() {
      try {
        const res = await fetch('/api/arena/seasons');
        const json = await res.json();
        if (json.success && json.data) {
          const completed = json.data.find((s: { status: string }) => s.status === 'COMPLETED');
          if (completed && completed.championAgentId) {
            setLastChampion({
              seasonNumber: completed.seasonNumber,
              champion: {
                id: completed.championAgentId,
                name: completed.championName || 'Unknown',
                score: 0,
              },
            });
          }
        }
      } catch {
        // Ignore
      }
    }
    fetchLastSeason();
  }, [season?.id]);

  if (!season) {
    return (
      <Card className="text-center py-3">
        <p className="text-xs text-neutral-500 uppercase tracking-wider">
          No active season — run a round to start Season 1
        </p>
      </Card>
    );
  }

  const seasonTotal = season.roundsTotal || 10;
  const computedSeasonNumber = currentRound > 0
    ? Math.floor((currentRound - 1) / seasonTotal) + 1
    : 0;
  const roundsCompleted = currentRound > 0
    ? ((currentRound - 1) % seasonTotal) + 1
    : 0;
  const progressPct = Math.min((roundsCompleted / seasonTotal) * 100, 100);
  const roundsRemaining = Math.max(seasonTotal - roundsCompleted, 0);
  const isNearEnd = roundsRemaining <= 5;

  return (
    <Card className={isNearEnd ? 'border-amber-800/50' : ''}>
      <div className="flex items-center justify-between">
        {/* Season Info */}
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
                Season {computedSeasonNumber}
              </span>
              <span className="text-[10px] text-cyber-500 bg-cyber-900/30 px-1.5 py-0.5 rounded uppercase tracking-wider">
                Active
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              {roundsRemaining} round{roundsRemaining !== 1 ? 's' : ''} remaining
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="flex-1 mx-6 max-w-xs">
          <div className="flex items-center justify-between text-[10px] text-neutral-500 mb-1">
            <span>Round {roundsCompleted}</span>
            <span>{seasonTotal}</span>
          </div>
          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isNearEnd ? 'bg-amber-500' : 'bg-cyber-500'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Last Champion */}
        {lastChampion && (
          <div className="text-right">
            <p className="text-[10px] text-neutral-500 uppercase tracking-wider">
              S{lastChampion.seasonNumber} Champion
            </p>
            <p className="text-xs text-amber-500 font-medium">
              {lastChampion.champion.name}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
