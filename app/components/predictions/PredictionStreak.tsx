'use client';

import { useEffect, useState } from 'react';

interface PredictionStreakProps {
  userWallet?: string;
}

export function PredictionStreak({ userWallet }: PredictionStreakProps) {
  const [streak, setStreak] = useState(0);
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!userWallet) return;

    async function fetchProfile() {
      try {
        const res = await fetch('/api/predictions/leaderboard?limit=50');
        const json = await res.json();
        if (json.success && json.data) {
          const profile = json.data.find((p: { userWallet: string }) =>
            p.userWallet.toLowerCase() === userWallet!.toLowerCase()
          );
          if (profile) {
            setStreak(profile.currentStreak);
            setScore(profile.totalScore);
          }
        }
      } catch {
        // Ignore
      }
    }

    fetchProfile();
    const interval = setInterval(fetchProfile, 10_000);
    return () => clearInterval(interval);
  }, [userWallet]);

  if (!userWallet || (streak === 0 && score === 0)) return null;

  return (
    <div className="flex items-center gap-2">
      {streak > 0 && (
        <span className="text-[10px] text-amber-500 bg-amber-900/30 px-1.5 py-0.5 rounded uppercase tracking-wider">
          {streak} streak
        </span>
      )}
      {score > 0 && (
        <span className="text-[10px] text-cyber-500 font-mono">
          {score} pts
        </span>
      )}
    </div>
  );
}
