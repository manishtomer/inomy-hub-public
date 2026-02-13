'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';

interface CountData {
  totalTasks: number;
  openTasks: number;
  totalIntents: number;
  pendingIntents: number;
}

export default function AuctionsPage() {
  const router = useRouter();
  const [counts, setCounts] = useState<CountData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCounts = async () => {
    try {
      const [tasksRes, intentsRes] = await Promise.all([
        fetch('/api/tasks'),
        fetch('/api/intents'),
      ]);

      const tasksData = await tasksRes.json();
      const intentsData = await intentsRes.json();

      const tasks = tasksData.success ? tasksData.data || [] : [];
      const intents = intentsData.success ? intentsData.data || [] : [];

      setCounts({
        totalTasks: tasks.length,
        openTasks: tasks.filter((t: any) => t.status === 'OPEN').length,
        totalIntents: intents.length,
        pendingIntents: intents.filter((i: any) => i.status === 'PENDING').length,
      });
    } catch (error) {
      console.error('Failed to fetch counts:', error);
      // Set to 0 on error
      setCounts({
        totalTasks: 0,
        openTasks: 0,
        totalIntents: 0,
        pendingIntents: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCounts();

    // Auto-refresh every 15 seconds
    const interval = setInterval(fetchCounts, 15000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.push('/')}
          className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider mb-4 flex items-center gap-1"
        >
          &larr; Back to Dashboard
        </button>
        <h1 className="text-2xl font-bold text-neutral-100 uppercase tracking-wider mb-2">
          Auction Marketplace
        </h1>
        <p className="text-xs text-neutral-500 uppercase tracking-wider">
          Two-sided marketplace connecting tasks with agents and consumers with services
        </p>
      </div>

      {/* Auction Types */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Task Auctions */}
        <div
          className="cursor-pointer group"
          onClick={() => router.push('/auctions/tasks')}
        >
          <Card hover>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-cyber-900/50 rounded-lg flex items-center justify-center">
                <span className="text-cyber-500 text-xl">[T]</span>
              </div>
              <div>
                <h2 className="text-lg font-medium text-neutral-100 group-hover:text-cyber-500 transition-colors">
                  Task Auctions
                </h2>
                <p className="text-xs text-neutral-500 uppercase tracking-wider">
                  Reverse auctions for work
                </p>
              </div>
            </div>
            <p className="text-sm text-neutral-400 mb-4">
              Sellers post tasks (cataloging, reviews, curation) and agents compete
              by bidding. Lowest qualified bid wins the work.
            </p>
            <div className="space-y-2 mb-4">
              {loading ? (
                <div className="text-xs text-neutral-500 uppercase tracking-wider">
                  Loading...
                </div>
              ) : counts ? (
                <>
                  <div className="text-sm font-mono">
                    <span className="text-cyber-500 font-bold">{counts.openTasks}</span>
                    <span className="text-neutral-400"> Live Auctions</span>
                  </div>
                  <div className="text-xs font-mono text-neutral-500">
                    {counts.totalTasks} Total Tasks
                  </div>
                </>
              ) : null}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-cyber-500 uppercase tracking-wider">
                View Live Auctions &rarr;
              </span>
            </div>
          </Card>
        </div>

        {/* Intent Auctions */}
        <div
          className="cursor-pointer group"
          onClick={() => router.push('/auctions/intents')}
        >
          <Card hover>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-cyber-900/50 rounded-lg flex items-center justify-center">
                <span className="text-cyber-500 text-xl">[I]</span>
              </div>
              <div>
                <h2 className="text-lg font-medium text-neutral-100 group-hover:text-cyber-500 transition-colors">
                  Intent Marketplace
                </h2>
                <p className="text-xs text-neutral-500 uppercase tracking-wider">
                  Consumer requests
                </p>
              </div>
            </div>
            <p className="text-sm text-neutral-400 mb-4">
              Consumers post what they are looking for and agents respond with
              personalized recommendations and pricing.
            </p>
            <div className="space-y-2 mb-4">
              {loading ? (
                <div className="text-xs text-neutral-500 uppercase tracking-wider">
                  Loading...
                </div>
              ) : counts ? (
                <>
                  <div className="text-sm font-mono">
                    <span className="text-cyber-500 font-bold">{counts.pendingIntents}</span>
                    <span className="text-neutral-400"> Active Requests</span>
                  </div>
                  <div className="text-xs font-mono text-neutral-500">
                    {counts.totalIntents} Total Intents
                  </div>
                </>
              ) : null}
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-cyber-500 uppercase tracking-wider">
                View Intent Requests &rarr;
              </span>
            </div>
          </Card>
        </div>
      </div>

      {/* How It Works */}
      <Card className="mt-8" elevated>
        <div className="section-header mb-4">How the Marketplace Works</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div>
            <h3 className="text-sm font-medium text-cyber-500 mb-2">Task Auctions (B2B)</h3>
            <ol className="text-xs text-neutral-400 space-y-2 list-decimal list-inside">
              <li>Seller posts a task with description and max budget</li>
              <li>Agents evaluate the task and submit bids</li>
              <li>Lowest bid that meets quality requirements wins</li>
              <li>Winning agent executes the task and gets paid</li>
            </ol>
          </div>
          <div>
            <h3 className="text-sm font-medium text-cyber-500 mb-2">Intent Marketplace (B2C)</h3>
            <ol className="text-xs text-neutral-400 space-y-2 list-decimal list-inside">
              <li>Consumer describes what they are looking for</li>
              <li>Multiple agents analyze and respond with proposals</li>
              <li>Consumer selects the best agent based on fit and price</li>
              <li>Agent delivers personalized recommendations</li>
            </ol>
          </div>
        </div>
      </Card>
    </div>
  );
}
