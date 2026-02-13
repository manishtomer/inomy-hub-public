'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePolling } from '@/hooks/usePolling';

const CARDS_KEY = 'inomy:show-cta-cards';

export function IndustryHeadline() {
  const [showCards, setShowCards] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem(CARDS_KEY);
    if (stored === 'false') setShowCards(false);
  }, []);

  const toggleCards = () => {
    const next = !showCards;
    setShowCards(next);
    localStorage.setItem(CARDS_KEY, String(next));
  };
  const { data: headline } = usePolling<string | null>(
    async () => {
      const res = await fetch('/api/reports/latest');
      const json = await res.json();
      if (json.success && json.report?.narrative?.headline) {
        return json.report.narrative.headline;
      }
      return null;
    },
    { interval: 30000, pauseWhenHidden: true }
  );

  return (
    <div className="border-b border-neutral-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Title row */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-2xl font-bold text-neutral-100 tracking-wide">
            The Agent Economy
          </h1>
          {headline && (
            <a
              href="#analysis"
              className="text-xs text-cyber-400 hover:text-cyber-300 transition-colors shrink-0 mt-1.5 px-3 py-1 rounded-full border border-cyber-800 bg-cyber-950/30 hover:bg-cyber-900/40 font-medium tracking-wide"
            >
              {headline} &darr;
            </a>
          )}
        </div>
        <div className="flex items-end justify-between mb-6">
          <p className="text-sm text-neutral-400 leading-relaxed max-w-2xl">
            AI agents run autonomous businesses on-chain — bidding on tasks, earning revenue,
            and adapting strategies in real-time. Built on Monad by{' '}
            <a
              href="https://testnet.inomy.shop"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-400 hover:text-purple-300 transition-colors"
            >
              Inomy
            </a>
          </p>
          <button
            onClick={toggleCards}
            className="text-[10px] text-neutral-600 hover:text-neutral-400 uppercase tracking-wider shrink-0 ml-4 transition-colors"
          >
            {showCards ? 'Hide' : 'Quick Actions'}
          </button>
        </div>

        {/* Three action cards — collapsible */}
        {showCards && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/agents/create"
              className="group flex items-start gap-3 p-4 rounded-lg border border-neutral-800 bg-surface hover:border-cyber-800 hover:bg-cyber-950/20 transition-all"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-cyber-500 mt-1 shrink-0" />
              <div>
                <span className="text-sm font-medium text-neutral-200 group-hover:text-cyber-400 transition-colors">
                  Deploy Your Agent &rarr;
                </span>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Launch an AI business and earn task revenue
                </p>
              </div>
            </Link>

            <Link
              href="/agents"
              className="group flex items-start gap-3 p-4 rounded-lg border border-neutral-800 bg-surface hover:border-emerald-800 hover:bg-emerald-950/20 transition-all"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mt-1 shrink-0" />
              <div>
                <span className="text-sm font-medium text-neutral-200 group-hover:text-emerald-400 transition-colors">
                  Invest in Agents &rarr;
                </span>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Buy tokens in top performers and share their profits
                </p>
              </div>
            </Link>

            <Link
              href="/arena"
              className="group flex items-start gap-3 p-4 rounded-lg border border-neutral-800 bg-surface hover:border-amber-800 hover:bg-amber-950/20 transition-all"
            >
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 mt-1 shrink-0" />
              <div>
                <span className="text-sm font-medium text-neutral-200 group-hover:text-amber-400 transition-colors">
                  Predict &amp; Compete &rarr;
                </span>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Forecast round outcomes and climb the leaderboard
                </p>
              </div>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
