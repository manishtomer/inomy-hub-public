'use client';

import { Card } from '@/components/ui/Card';
import { usePolling } from '@/hooks/usePolling';
import type { InvestorPortfolio } from '@/types/database';

export function InvestorLeaderboard() {
  const { data: portfolios, loading, error, lastUpdated } = usePolling<InvestorPortfolio[]>(
    async () => {
      const res = await fetch('/api/investors?include_portfolio=true');
      const json = await res.json();

      if (json.success && json.data) {
        // Sort by P&L percentage descending
        const sorted = [...json.data].sort(
          (a, b) => (b.pnl_percent || 0) - (a.pnl_percent || 0)
        );
        return sorted;
      } else {
        throw new Error(json.error || 'Failed to fetch portfolios');
      }
    },
    {
      interval: 12000, // 12 seconds
      pauseWhenHidden: true,
    }
  );

  const getTimeAgo = (date: Date | null): string => {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  if (loading) {
    return (
      <Card>
        <div className="section-header">INVESTOR LEADERBOARD</div>
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          LOADING<span className="animate-blink">▋</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="section-header">INVESTOR LEADERBOARD</div>
        <div className="text-red-500 text-sm font-mono">ERROR: {error}</div>
      </Card>
    );
  }

  if (!portfolios || !portfolios.length) {
    return (
      <Card>
        <div className="section-header">INVESTOR LEADERBOARD</div>
        <div className="text-neutral-500 text-sm font-mono">NO INVESTORS</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="section-header mb-0">INVESTOR LEADERBOARD</div>
        <span className="text-xs text-neutral-600 font-mono">
          {lastUpdated && `Updated ${getTimeAgo(lastUpdated)}`}
        </span>
      </div>

      <div className="space-y-2">
        {portfolios.map((portfolio, index) => {
          const pnl = portfolio.pnl_percent || 0;
          const isProfitable = pnl > 0;
          const isNeutral = pnl === 0;

          return (
            <div
              key={portfolio.investor.id}
              className="flex items-center justify-between p-3 bg-elevated border border-neutral-800 rounded hover:border-neutral-700 transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="text-neutral-500 font-mono text-xs w-6">
                  #{index + 1}
                </div>
                <div>
                  <div className="text-sm text-neutral-200 font-medium">
                    {portfolio.investor.name}
                  </div>
                  <div className="text-xs text-neutral-500 font-mono">
                    {portfolio.holdings.length} holdings
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div
                  className={`font-mono text-sm font-medium ${
                    isProfitable
                      ? 'text-emerald-500'
                      : isNeutral
                      ? 'text-neutral-400'
                      : 'text-red-500'
                  }`}
                >
                  {isProfitable ? '+' : ''}
                  {pnl.toFixed(1)}%
                </div>
                <div className="text-xs text-neutral-500 font-mono">
                  ${portfolio.current_value.toFixed(2)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
