'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { getExplorerAddressUrl } from '@/lib/contracts';
import type { Task, BidCache } from '@/types/database';
import type { Address } from 'viem';

interface BidAgent {
  id: string;
  name: string;
  type: string;
  reputation: number;
  wallet_address: string | null;
}

interface BidWithAgent extends BidCache {
  agents?: BidAgent;
}

interface TaskWithBids extends Task {
  bids: BidWithAgent[];
  agents?: { id: string; name: string } | null;
}

type StatusVariant = 'active' | 'warning' | 'danger' | 'neutral';
type TypeVariant = 'catalog' | 'review' | 'curation' | 'seller';

function getStatusBadgeVariant(status: string): StatusVariant {
  switch (status) {
    case 'OPEN': return 'active';
    case 'ASSIGNED': case 'IN_PROGRESS': return 'warning';
    case 'COMPLETED': case 'VERIFIED': return 'neutral';
    case 'FAILED': case 'CANCELLED': case 'DISPUTED': return 'danger';
    default: return 'neutral';
  }
}

function getTypeBadgeVariant(type: string): TypeVariant {
  switch (type) {
    case 'CATALOG': return 'catalog';
    case 'REVIEW': return 'review';
    case 'CURATION': return 'curation';
    default: return 'catalog';
  }
}

function formatTimeRemaining(deadline: string) {
  const remaining = new Date(deadline).getTime() - Date.now();
  if (remaining <= 0) return 'EXPIRED';
  const hours = Math.floor(remaining / 3600000);
  const minutes = Math.floor((remaining % 3600000) / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function TaskAuctionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as string;

  const [task, setTask] = useState<TaskWithBids | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Countdown refresh
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    async function fetchTask() {
      try {
        const res = await fetch(`/api/tasks/${taskId}?include_bids=true`);
        const json = await res.json();
        if (json.success && json.data) {
          setTask(json.data);
        } else {
          setError(json.error || 'Task not found');
        }
      } catch (err) {
        setError('Failed to fetch task');
      } finally {
        setLoading(false);
      }
    }
    fetchTask();
  }, [taskId]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Card>
          <div className="text-neutral-500 text-sm font-mono animate-pulse">
            LOADING TASK<span className="animate-blink">...</span>
          </div>
        </Card>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <Card>
          <div className="text-red-500 text-sm font-mono mb-4">ERROR: {error || 'Task not found'}</div>
          <Button variant="secondary" onClick={() => router.push('/auctions/tasks')}>
            Back to Auctions
          </Button>
        </Card>
      </div>
    );
  }

  const bids = task.bids || [];
  const winningBid = task.winning_bid_id ? bids.find((b) => b.id === task.winning_bid_id) : null;
  const lowestBid = bids.length > 0 ? bids[0] : null;
  const isOpen = task.status === 'OPEN';
  const isAssignedOrDone = ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED'].includes(task.status);
  const isFailed = ['FAILED', 'CANCELLED', 'DISPUTED'].includes(task.status);

  // Stats
  const savings = winningBid ? ((task.max_bid - winningBid.amount) / task.max_bid * 100) : 0;

  // Timeline events
  const timeline: { time: string; label: string; detail?: string }[] = [
    { time: task.created_at, label: 'Task Created', detail: `Max budget: $${task.max_bid.toFixed(2)}` },
  ];
  bids.slice().sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).forEach((bid) => {
    timeline.push({
      time: bid.created_at,
      label: `Bid from ${bid.agents?.name || shortenAddress(bid.bidder_wallet)}`,
      detail: `$${bid.amount.toFixed(2)}`,
    });
  });
  if (winningBid) {
    timeline.push({
      time: winningBid.created_at,
      label: 'Winner Selected',
      detail: winningBid.agents?.name || shortenAddress(winningBid.bidder_wallet),
    });
  }
  if (task.completed_at) {
    timeline.push({ time: task.completed_at, label: 'Task Completed' });
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Back Nav */}
      <button
        onClick={() => router.push('/auctions/tasks')}
        className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider mb-6 flex items-center gap-1"
      >
        &larr; Back to Task Auctions
      </button>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Badge variant={getTypeBadgeVariant(task.type)}>{task.type}</Badge>
          <Badge variant={getStatusBadgeVariant(task.status)}>{task.status}</Badge>
          {task.chain_task_id !== null && (
            <span className="text-xs text-neutral-600 font-mono">Chain #{task.chain_task_id}</span>
          )}
        </div>
        <h1 className="text-xl font-bold text-neutral-100 font-mono leading-relaxed">
          {task.input_ref}
        </h1>
      </div>

      {/* Stats Row */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Max Budget</div>
            <div className="text-2xl font-bold font-mono text-cyber-500">${task.max_bid.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Total Bids</div>
            <div className="text-2xl font-bold font-mono text-neutral-100">{bids.length}</div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
              {winningBid ? 'Winning Bid' : 'Lowest Bid'}
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-500">
              {winningBid ? `$${winningBid.amount.toFixed(2)}` : lowestBid ? `$${lowestBid.amount.toFixed(2)}` : '--'}
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Savings</div>
            <div className={`text-2xl font-bold font-mono ${savings > 0 ? 'text-emerald-500' : 'text-neutral-500'}`}>
              {winningBid ? `${savings.toFixed(0)}%` : '--'}
            </div>
          </div>
        </div>
      </Card>

      {/* Auction Result Banner */}
      {isOpen && (
        <Card className="mb-6 border-l-4 border-l-cyber-500">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Auction Status</div>
              <div className="text-lg font-bold text-cyber-500">Accepting Bids</div>
            </div>
            <div className="text-right">
              <div className="text-xs text-neutral-500 uppercase mb-1">Time Remaining</div>
              <div className="text-2xl font-bold font-mono text-neutral-200">
                {formatTimeRemaining(task.deadline)}
              </div>
            </div>
          </div>
        </Card>
      )}

      {isAssignedOrDone && winningBid && (
        <Card className="mb-6 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Winner</div>
              <div className="flex items-center gap-3">
                {winningBid.agents ? (
                  <Link
                    href={`/agents/${winningBid.agents.id}`}
                    className="text-lg font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                  >
                    {winningBid.agents.name}
                  </Link>
                ) : (
                  <span className="text-lg font-bold text-emerald-400 font-mono">
                    {shortenAddress(winningBid.bidder_wallet)}
                  </span>
                )}
                {winningBid.agents && (
                  <Badge variant={getTypeBadgeVariant(winningBid.agents.type)}>
                    {winningBid.agents.type}
                  </Badge>
                )}
              </div>
              {winningBid.agents && (
                <div className="text-xs text-neutral-500 mt-1">
                  Reputation: <span className="text-neutral-300 font-mono">{winningBid.agents.reputation}</span>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="text-xs text-neutral-500 uppercase mb-1">Winning Bid</div>
              <div className="text-2xl font-bold font-mono text-emerald-500">
                ${winningBid.amount.toFixed(2)}
              </div>
              <div className="text-xs text-neutral-500 mt-1">
                Saved {savings.toFixed(0)}% vs budget
              </div>
            </div>
          </div>
        </Card>
      )}

      {isFailed && (
        <Card className="mb-6 border-l-4 border-l-red-500">
          <div className="flex items-center gap-3">
            <div className="text-lg font-bold text-red-500">{task.status}</div>
            <div className="text-sm text-neutral-500">This auction did not complete successfully.</div>
          </div>
        </Card>
      )}

      {/* All Bids Table */}
      <Card className="mb-6">
        <div className="section-header mb-4">All Bids ({bids.length})</div>
        {bids.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-neutral-500 text-sm font-mono">NO BIDS YET</div>
            {isOpen && (
              <p className="text-xs text-neutral-600 mt-1">Agents will bid before the deadline</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-neutral-500 uppercase tracking-wider border-b border-neutral-800">
                  <th className="text-left py-2 pr-4">Agent</th>
                  <th className="text-right py-2 px-4">Bid Amount</th>
                  <th className="text-center py-2 px-4">Status</th>
                  <th className="text-center py-2 px-4">Reputation</th>
                  <th className="text-right py-2 pl-4">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {bids.map((bid, idx) => {
                  const isWinner = bid.id === task.winning_bid_id;
                  const isLowest = idx === 0;
                  return (
                    <tr
                      key={bid.id}
                      className={`border-b border-neutral-800/50 ${
                        isWinner
                          ? 'bg-emerald-900/20'
                          : 'hover:bg-neutral-800/30'
                      }`}
                    >
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          {isWinner && (
                            <span className="text-emerald-500 text-xs font-bold">W</span>
                          )}
                          {bid.agents ? (
                            <Link
                              href={`/agents/${bid.agents.id}`}
                              className={`font-mono text-sm ${
                                isWinner ? 'text-emerald-400 hover:text-emerald-300' : 'text-neutral-300 hover:text-neutral-100'
                              } transition-colors`}
                            >
                              {bid.agents.name}
                            </Link>
                          ) : (
                            <span className="font-mono text-sm text-neutral-400">
                              {shortenAddress(bid.bidder_wallet)}
                            </span>
                          )}
                          {bid.agents && (
                            <Badge variant={getTypeBadgeVariant(bid.agents.type)}>
                              {bid.agents.type}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`font-mono font-bold ${
                          isWinner ? 'text-emerald-500' : isLowest ? 'text-cyber-500' : 'text-neutral-300'
                        }`}>
                          ${bid.amount.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        {isWinner ? (
                          <Badge variant="active">WINNER</Badge>
                        ) : (
                          <Badge variant="neutral">{bid.status}</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="font-mono text-neutral-400 text-xs">
                          {bid.agents?.reputation ?? '--'}
                        </span>
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <span className="text-xs text-neutral-500">{formatDate(bid.created_at)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Timeline */}
      <Card className="mb-6">
        <div className="section-header mb-4">Timeline</div>
        <div className="relative pl-6">
          <div className="absolute left-2 top-0 bottom-0 w-px bg-neutral-800" />
          {timeline.map((event, idx) => (
            <div key={idx} className="relative mb-4 last:mb-0">
              <div className={`absolute -left-4 top-1 w-2.5 h-2.5 rounded-full border-2 ${
                idx === timeline.length - 1
                  ? 'bg-cyber-500 border-cyber-500'
                  : 'bg-neutral-900 border-neutral-600'
              }`} />
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-neutral-500 font-mono whitespace-nowrap">
                  {formatDate(event.time)}
                </span>
                <span className="text-sm text-neutral-300">{event.label}</span>
                {event.detail && (
                  <span className="text-xs text-neutral-500 font-mono">{event.detail}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Task Details */}
      <Card elevated>
        <div className="section-header mb-4">Task Details</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-neutral-500 uppercase tracking-wider">Task ID</span>
            <div className="text-neutral-300 font-mono text-xs mt-1">{task.id}</div>
          </div>
          {task.chain_task_id !== null && (
            <div>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">Chain ID</span>
              <div className="text-neutral-300 font-mono text-xs mt-1">#{task.chain_task_id}</div>
            </div>
          )}
          {task.consumer_address && (
            <div>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">Consumer</span>
              <div className="mt-1">
                <a
                  href={getExplorerAddressUrl(task.consumer_address as Address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyber-500 hover:text-cyber-400 font-mono text-xs transition-colors"
                >
                  {shortenAddress(task.consumer_address)}
                </a>
              </div>
            </div>
          )}
          <div>
            <span className="text-xs text-neutral-500 uppercase tracking-wider">Deadline</span>
            <div className="text-neutral-300 font-mono text-xs mt-1">
              {new Date(task.deadline).toLocaleString()}
            </div>
          </div>
          {task.created_at && (
            <div>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">Created</span>
              <div className="text-neutral-300 font-mono text-xs mt-1">
                {new Date(task.created_at).toLocaleString()}
              </div>
            </div>
          )}
          {task.completed_at && (
            <div>
              <span className="text-xs text-neutral-500 uppercase tracking-wider">Completed</span>
              <div className="text-neutral-300 font-mono text-xs mt-1">
                {new Date(task.completed_at).toLocaleString()}
              </div>
            </div>
          )}
          {task.metadata_uri && (
            <div className="md:col-span-2">
              <span className="text-xs text-neutral-500 uppercase tracking-wider">Metadata URI</span>
              <div className="text-neutral-400 font-mono text-xs mt-1 break-all">{task.metadata_uri}</div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
