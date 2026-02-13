'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';

interface PredictionProfile {
  userWallet: string;
  totalPredictions: number;
  correctPredictions: number;
  currentStreak: number;
  bestStreak: number;
  totalScore: number;
  accuracy: number;
}

export function PredictionLeaderboard() {
  const [profiles, setProfiles] = useState<PredictionProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const res = await fetch('/api/predictions/leaderboard');
        const json = await res.json();
        if (json.success && json.data) {
          setProfiles(json.data);
        }
      } catch {
        // Ignore
      } finally {
        setLoading(false);
      }
    }

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 15_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Card>
        <div className="text-xs text-neutral-500 animate-pulse">Loading prediction leaderboard...</div>
      </Card>
    );
  }

  if (profiles.length === 0) {
    return (
      <Card>
        <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-2">
          Prediction Leaderboard
        </h3>
        <p className="text-xs text-neutral-500">No predictions yet — be the first!</p>
      </Card>
    );
  }

  return (
    <Card>
      <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider mb-4">
        Prediction Leaderboard
      </h3>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-neutral-500 uppercase tracking-wider border-b border-neutral-800">
              <th className="text-left py-2 pr-2">#</th>
              <th className="text-left py-2 pr-3">Wallet</th>
              <th className="text-right py-2 pr-3">Score</th>
              <th className="text-right py-2 pr-3">Accuracy</th>
              <th className="text-right py-2 pr-3">Streak</th>
              <th className="text-right py-2">Best</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile, i) => (
              <tr key={profile.userWallet} className="border-b border-neutral-800/50">
                <td className={`py-2 pr-2 text-xs font-bold ${
                  i === 0 ? 'text-amber-400' : i === 1 ? 'text-neutral-300' : i === 2 ? 'text-amber-700' : 'text-neutral-500'
                }`}>
                  {i + 1}
                </td>
                <td className="py-2 pr-3 text-xs text-neutral-300 font-mono">
                  {profile.userWallet.slice(0, 6)}...{profile.userWallet.slice(-4)}
                </td>
                <td className="py-2 pr-3 text-xs text-right font-mono text-cyber-500 font-bold">
                  {profile.totalScore}
                </td>
                <td className="py-2 pr-3 text-xs text-right text-neutral-400">
                  {profile.accuracy}%
                </td>
                <td className="py-2 pr-3 text-xs text-right text-neutral-400">
                  {profile.currentStreak}
                </td>
                <td className="py-2 text-xs text-right text-amber-500">
                  {profile.bestStreak}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
