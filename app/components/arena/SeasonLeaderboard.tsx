'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge, getTypeBadgeVariant } from '@/components/ui/Badge';
import { AgentAvatar } from '@/components/ui/AgentAvatar';

interface LeaderboardEntry {
  rank: number;
  agentId: string;
  agentName: string;
  agentType: string;
  score: number;
  balanceDelta: number;
  winRate: number;
  reputationDelta: number;
  tasksWon: number;
  tasksBid: number;
}

interface SeasonLeaderboardProps {
  seasonId?: string;
}

const RANK_STYLES: Record<number, string> = {
  1: 'text-amber-400',
  2: 'text-neutral-300',
  3: 'text-amber-700',
};

export function SeasonLeaderboard({ seasonId }: SeasonLeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!seasonId) {
      setLoading(false);
      return;
    }

    async function fetchLeaderboard() {
      try {
        const res = await fetch(`/api/arena/seasons/${seasonId}/leaderboard`);
        const json = await res.json();
        if (json.success && json.data) {
          setEntries(json.data);
        }
      } catch {
        // Ignore
      } finally {
        setLoading(false);
      }
    }

    fetchLeaderboard();
    // Refresh every 10s
    const interval = setInterval(fetchLeaderboard, 10_000);
    return () => clearInterval(interval);
  }, [seasonId]);

  if (!seasonId) return null;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
          Season Leaderboard
        </h3>
        <span className="text-xs text-neutral-500">
          {entries.length} agent{entries.length !== 1 ? 's' : ''}
        </span>
      </div>

      {loading ? (
        <div className="text-xs text-neutral-500 animate-pulse">Loading leaderboard...</div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-neutral-500">
          No rankings yet — run some rounds to populate
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-neutral-500 uppercase tracking-wider border-b border-neutral-800">
                <th className="text-left py-2 pr-2">#</th>
                <th className="text-left py-2 pr-3">Agent</th>
                <th className="text-left py-2 pr-3">Type</th>
                <th className="text-right py-2 pr-3">Score</th>
                <th className="text-right py-2 pr-3">Win Rate</th>
                <th className="text-right py-2 pr-3">Balance Δ</th>
                <th className="text-right py-2">Rep Δ</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.agentId}
                  className={`border-b border-neutral-800/50 ${
                    entry.rank <= 3 ? 'bg-neutral-800/20' : ''
                  }`}
                >
                  <td className={`py-2 pr-2 text-xs font-bold ${RANK_STYLES[entry.rank] || 'text-neutral-500'}`}>
                    {entry.rank}
                  </td>
                  <td className="py-2 pr-3">
                    <Link href={`/agents/${entry.agentId}`} className="flex items-center gap-2 hover:underline">
                      <AgentAvatar name={entry.agentName} size={22} />
                      <span className="text-xs text-neutral-200 font-medium hover:text-cyber-500 transition-colors">{entry.agentName}</span>
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge variant={getTypeBadgeVariant(entry.agentType)}>
                      {entry.agentType}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-xs text-right font-mono text-neutral-300">
                    {entry.score.toFixed(2)}
                  </td>
                  <td className="py-2 pr-3 text-xs text-right font-mono text-neutral-400">
                    {(entry.winRate * 100).toFixed(1)}%
                  </td>
                  <td className={`py-2 pr-3 text-xs text-right font-mono ${
                    entry.balanceDelta >= 0 ? 'text-emerald-500' : 'text-red-400'
                  }`}>
                    {entry.balanceDelta >= 0 ? '+' : ''}{entry.balanceDelta.toFixed(4)}
                  </td>
                  <td className={`py-2 text-xs text-right font-mono ${
                    entry.reputationDelta >= 0 ? 'text-emerald-500' : 'text-red-400'
                  }`}>
                    {entry.reputationDelta >= 0 ? '+' : ''}{entry.reputationDelta.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
