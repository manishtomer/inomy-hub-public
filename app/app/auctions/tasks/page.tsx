'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { usePolling } from '@/hooks/usePolling';
import type { Task, BidCache } from '@/types/database';

interface BidWithAgent extends BidCache {
  agents?: {
    id: string;
    name: string;
  };
}

interface TaskWithBids extends Task {
  bids: BidWithAgent[];
  assigned_agent_name?: string;
  time_remaining_ms: number;
}

type FilterStatus = 'ALL' | 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED';

export default function TaskAuctionPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [, setTick] = useState(0); // For countdown refresh

  // Use polling hook for auto-refresh
  const {
    data: tasks,
    loading,
    error: pollingError,
    lastUpdated,
    isPolling,
    refresh,
    togglePolling,
  } = usePolling<TaskWithBids[]>(
    async () => {
      const res = await fetch('/api/tasks?include_bids=true');
      const json = await res.json();

      if (json.success && json.data) {
        return json.data;
      } else {
        throw new Error(json.error || 'Failed to fetch tasks');
      }
    },
    { interval: 10000, enabled: false } // Start with polling disabled
  );

  const error = pollingError;
  const taskList = tasks || [];

  // Update countdown every second
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Format time since last update
  const formatTimeSince = (date: Date | null) => {
    if (!date) return '';
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  const formatTimeRemaining = (deadline: string) => {
    const remaining = new Date(deadline).getTime() - Date.now();
    if (remaining <= 0) return 'EXPIRED';

    const hours = Math.floor(remaining / 3600000);
    const minutes = Math.floor((remaining % 3600000) / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  };

  const getTimeUrgency = (deadline: string) => {
    const remaining = new Date(deadline).getTime() - Date.now();
    if (remaining <= 0) return 'expired';
    if (remaining < 10 * 60 * 1000) return 'critical'; // < 10 min
    if (remaining < 30 * 60 * 1000) return 'urgent'; // < 30 min
    return 'normal';
  };

  const getStatusBadgeVariant = (status: string): 'active' | 'warning' | 'danger' | 'neutral' => {
    switch (status) {
      case 'OPEN': return 'active';
      case 'ASSIGNED': return 'warning';
      case 'IN_PROGRESS': return 'warning';
      case 'COMPLETED': return 'neutral';
      case 'FAILED': return 'danger';
      default: return 'neutral';
    }
  };

  const getTypeBadgeVariant = (type: string): 'catalog' | 'review' | 'curation' | 'seller' => {
    switch (type) {
      case 'CATALOG': return 'catalog';
      case 'REVIEW': return 'review';
      case 'CURATION': return 'curation';
      default: return 'catalog';
    }
  };

  const filteredTasks = filter === 'ALL'
    ? taskList
    : taskList.filter((t) => t.status === filter);

  // Separate open tasks (for bidding) and other tasks
  const openTasks = filteredTasks.filter((t) => t.status === 'OPEN');
  const otherTasks = filteredTasks.filter((t) => t.status !== 'OPEN');

  // Calculate summary stats
  const totalTasks = taskList.length;
  const openCount = taskList.filter((t) => t.status === 'OPEN').length;
  const assignedCount = taskList.filter((t) => t.status === 'ASSIGNED').length;
  const completedCount = taskList.filter((t) => t.status === 'COMPLETED').length;
  const totalValue = taskList.reduce((sum, t) => sum + t.max_bid, 0);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Card>
          <div className="text-neutral-500 text-sm font-mono animate-pulse">
            LOADING AUCTIONS<span className="animate-blink">...</span>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Card>
          <div className="text-red-500 text-sm font-mono mb-4">ERROR: {error}</div>
          <Button variant="secondary" onClick={() => router.push('/')}>
            Back to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/')}
          className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider mb-4 flex items-center gap-1"
        >
          &larr; Back to Dashboard
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100 uppercase tracking-wider mb-1">
              Task Auctions
            </h1>
            <p className="text-xs text-neutral-500 uppercase tracking-wider">
              Agents compete for tasks through reverse auctions
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/auctions/intents">
              <Button variant="ghost">
                Intent Marketplace &rarr;
              </Button>
            </Link>
            <Button
              variant={isPolling ? 'primary' : 'secondary'}
              onClick={togglePolling}
            >
              Auto-refresh: {isPolling ? 'ON' : 'OFF'}
            </Button>
            <Button variant="secondary" onClick={refresh}>
              Refresh
            </Button>
          </div>
        </div>
        {lastUpdated && (
          <div className="text-xs text-neutral-500 font-mono mt-2">
            Last updated: {formatTimeSince(lastUpdated)}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Total Tasks</div>
            <div className="text-2xl font-bold font-mono text-neutral-100">{totalTasks}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Open</div>
            <div className="text-2xl font-bold font-mono text-emerald-500">{openCount}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Assigned</div>
            <div className="text-2xl font-bold font-mono text-cyber-500">{assignedCount}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Completed</div>
            <div className="text-2xl font-bold font-mono text-neutral-400">{completedCount}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Total Value</div>
            <div className="text-2xl font-bold font-mono text-cyber-500">${totalValue.toFixed(4)}</div>
          </div>
        </div>
      </Card>

      {/* Filter Tabs */}
      <Card className="mb-6">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED'] as FilterStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wider rounded transition-colors ${
                filter === status
                  ? 'bg-cyber-600 text-void'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
              }`}
            >
              {status.replace('_', ' ')}
              <span className="ml-1 text-neutral-500">
                ({status === 'ALL' ? taskList.length : taskList.filter((t) => t.status === status).length})
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* Open Auctions - Featured */}
      {(filter === 'ALL' || filter === 'OPEN') && openTasks.length > 0 && (
        <div className="mb-8">
          <div className="section-header mb-4">Live Auctions</div>
          <div className="grid gap-4">
            {openTasks.map((task) => {
              const urgency = getTimeUrgency(task.deadline);
              const bids = task.bids || [];
              const lowestBid = bids.length > 0 ? bids[0] : null;

              return (
                <Card key={task.id} className="border-l-4 border-l-cyber-500">
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    {/* Task Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant={getTypeBadgeVariant(task.type)}>{task.type}</Badge>
                        <Badge variant="active">OPEN</Badge>
                        <span className="text-xs text-neutral-500 font-mono">{task.id}</span>
                      </div>
                      <Link
                        href={`/auctions/tasks/${task.id}`}
                        className="text-neutral-300 hover:text-cyber-400 mb-2 font-mono text-sm block transition-colors"
                      >
                        {task.input_ref}
                      </Link>
                      <div className="flex items-center gap-3 text-xs text-neutral-500">
                        <span>Max Budget: <span className="text-cyber-500 font-mono">${task.max_bid.toFixed(4)}</span></span>
                        <Link
                          href={`/auctions/tasks/${task.id}`}
                          className="text-cyber-500 hover:text-cyber-400 uppercase tracking-wider transition-colors"
                        >
                          View Details &rarr;
                        </Link>
                      </div>
                    </div>

                    {/* Countdown */}
                    <div className="text-center lg:text-right">
                      <div className="text-xs text-neutral-500 uppercase mb-1">Time Remaining</div>
                      <div className={`font-mono text-xl font-bold ${
                        urgency === 'critical' ? 'text-red-500 animate-pulse' :
                        urgency === 'urgent' ? 'text-amber-500' :
                        'text-neutral-200'
                      }`}>
                        {formatTimeRemaining(task.deadline)}
                      </div>
                    </div>

                    {/* Bids Summary */}
                    <div className="lg:w-48">
                      <div className="text-xs text-neutral-500 uppercase mb-2">
                        {bids.length} Bid{bids.length !== 1 ? 's' : ''}
                      </div>
                      {lowestBid ? (
                        <div className="p-2 bg-elevated rounded border border-emerald-900/50">
                          <div className="text-xs text-neutral-500">Leading Bid</div>
                          <div className="text-emerald-500 font-mono font-bold">
                            ${lowestBid.amount.toFixed(4)}
                          </div>
                          {lowestBid.agents ? (
                            <Link
                              href={`/agents/${lowestBid.agents.id}`}
                              className="text-xs text-neutral-500 hover:text-neutral-400 font-mono underline decoration-dotted"
                            >
                              {lowestBid.agents.name}
                            </Link>
                          ) : (
                            <div className="text-xs text-neutral-500 font-mono truncate">
                              {lowestBid.bidder_wallet.slice(0, 16)}...
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="p-2 bg-elevated rounded border border-neutral-800 text-center">
                          <div className="text-xs text-neutral-500">No bids yet</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Bid List */}
                  {bids.length > 1 && (
                    <div className="mt-4 pt-4 border-t border-neutral-800">
                      <div className="text-xs text-neutral-500 uppercase mb-2">All Bids</div>
                      <div className="flex flex-wrap gap-2">
                        {bids.map((bid, idx) => (
                          <div
                            key={bid.id}
                            className={`px-2 py-1.5 rounded text-xs font-mono ${
                              idx === 0
                                ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/50'
                                : 'bg-neutral-800 text-neutral-400'
                            }`}
                          >
                            <div className="font-bold">${bid.amount.toFixed(4)}</div>
                            {bid.agents && (
                              <Link
                                href={`/agents/${bid.agents.id}`}
                                className={`${
                                  idx === 0 ? 'text-emerald-500 hover:text-emerald-400' : 'text-neutral-500 hover:text-neutral-400'
                                } underline decoration-dotted text-[10px]`}
                              >
                                {bid.agents.name}
                              </Link>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Other Tasks */}
      {otherTasks.length > 0 && (
        <div>
          <div className="section-header mb-4">
            {filter === 'ALL' ? 'Other Tasks' : `${filter.replace('_', ' ')} Tasks`}
          </div>
          <div className="space-y-3">
            {otherTasks.map((task) => {
              const bids = task.bids || [];
              const winnerBid = task.winning_bid_id ? bids.find((b) => b.id === task.winning_bid_id) : null;
              return (
                <Link key={task.id} href={`/auctions/tasks/${task.id}`} className="block">
                  <Card elevated hover>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant={getTypeBadgeVariant(task.type)}>{task.type}</Badge>
                        <Badge variant={getStatusBadgeVariant(task.status)}>{task.status}</Badge>
                        <span className="text-neutral-300 font-mono text-sm">{task.input_ref}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        {bids.length > 0 && (
                          <div className="text-xs text-neutral-500 font-mono">
                            {bids.length} bid{bids.length !== 1 ? 's' : ''}
                          </div>
                        )}
                        {winnerBid?.agents && (
                          <div className="text-xs text-emerald-500 font-mono">
                            {winnerBid.agents.name} @ ${winnerBid.amount.toFixed(4)}
                          </div>
                        )}
                        <div className="text-xs text-neutral-500 font-mono">
                          ${task.max_bid.toFixed(4)}
                        </div>
                        <div className={`text-xs font-mono ${
                          task.status === 'COMPLETED' ? 'text-neutral-500' : 'text-neutral-400'
                        }`}>
                          {task.status === 'COMPLETED' ? 'Done' : formatTimeRemaining(task.deadline)}
                        </div>
                      </div>
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredTasks.length === 0 && (
        <Card className="text-center py-12">
          <div className="text-neutral-500 text-sm font-mono mb-2">NO TASKS FOUND</div>
          <p className="text-xs text-neutral-600">
            {filter === 'ALL'
              ? 'No tasks available at this time'
              : `No ${filter.replace('_', ' ').toLowerCase()} tasks`}
          </p>
        </Card>
      )}

      {/* Legend */}
      <Card className="mt-8" elevated>
        <div className="section-header mb-3">How Task Auctions Work</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-neutral-400">
          <div>
            <span className="text-cyber-500 font-bold">1. Task Posted</span>
            <p className="mt-1">Sellers post tasks with a maximum budget and deadline</p>
          </div>
          <div>
            <span className="text-cyber-500 font-bold">2. Agents Bid</span>
            <p className="mt-1">Agents submit bids (reverse auction - lowest wins)</p>
          </div>
          <div>
            <span className="text-cyber-500 font-bold">3. Winner Executes</span>
            <p className="mt-1">Winning agent completes the task and earns payment</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
