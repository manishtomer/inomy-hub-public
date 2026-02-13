'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';

interface BidEntry {
  agent_id: string;
  agent_name: string;
  agent_type: string | null;
  amount: number | null;
  score: number | null;
  status: string;
}

interface TaskResult {
  id: string;
  type: string;
  status: string;
  input_ref?: string;
  bids: BidEntry[];
  winner: { agent_name: string; amount: number } | null;
}

interface RoundSummary {
  total_tasks: number;
  total_bids: number;
  tasks_completed: number;
  revenue: number;
}

interface Round {
  round_number: number;
  tasks: TaskResult[];
  summary: RoundSummary;
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-neutral-500 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

const TYPE_COLORS: Record<string, string> = {
  CATALOG: 'text-sky-400 bg-sky-900/20 border-sky-800/40',
  REVIEW: 'text-amber-400 bg-amber-900/20 border-amber-800/40',
  CURATION: 'text-purple-400 bg-purple-900/20 border-purple-800/40',
  SELLER: 'text-emerald-400 bg-emerald-900/20 border-emerald-800/40',
};

function TaskTypeTag({ type }: { type: string }) {
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider border ${TYPE_COLORS[type] || 'text-neutral-400 bg-neutral-900/20 border-neutral-800/40'}`}>
      {type}
    </span>
  );
}

/**
 * Compact columnar bid matrix for a round.
 * Columns = agents who bid on at least one task in this round.
 * Rows = tasks. Cells = bid amount, winner highlighted.
 */
function RoundBidMatrix({ round }: { round: Round }) {
  // Collect agents who actually bid in this round (skip the "skipped" ones)
  const biddingAgents = useMemo(() => {
    const agentMap = new Map<string, { id: string; name: string }>();
    for (const task of round.tasks) {
      for (const bid of task.bids) {
        if (bid.status !== 'skipped' && !agentMap.has(bid.agent_id)) {
          agentMap.set(bid.agent_id, { id: bid.agent_id, name: bid.agent_name });
        }
      }
    }
    return Array.from(agentMap.values());
  }, [round]);

  // Build lookup: taskId -> agentId -> bid
  const bidLookup = useMemo(() => {
    const lookup = new Map<string, Map<string, BidEntry>>();
    for (const task of round.tasks) {
      const taskBids = new Map<string, BidEntry>();
      for (const bid of task.bids) {
        taskBids.set(bid.agent_id, bid);
      }
      lookup.set(task.id, taskBids);
    }
    return lookup;
  }, [round]);

  if (biddingAgents.length === 0) {
    return <div className="text-neutral-600 text-xs font-mono px-2 py-2">No bids placed</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-neutral-600">
            <th className="text-left px-2 py-1.5 font-medium sticky left-0 bg-surface">Task</th>
            {biddingAgents.map(agent => (
              <th key={agent.id} className="text-right px-2 py-1.5 font-medium whitespace-nowrap">
                <Link href={`/agents/${agent.id}`} className="hover:text-cyber-500 hover:underline transition-colors">
                  {agent.name}
                </Link>
              </th>
            ))}
            <th className="text-right px-2 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {round.tasks.map(task => {
            const taskBids = bidLookup.get(task.id);
            return (
              <tr key={task.id} className="border-t border-neutral-800/30">
                <td className="px-2 py-1.5 sticky left-0 bg-surface">
                  <div className="flex items-center gap-1.5">
                    <TaskTypeTag type={task.type} />
                    <span className="text-neutral-500 truncate max-w-[180px]" title={task.input_ref}>
                      {task.input_ref?.replace(/\s*\[.*\]$/, '').slice(0, 28) || task.id.slice(0, 8)}
                    </span>
                  </div>
                </td>
                {biddingAgents.map(agent => {
                  const bid = taskBids?.get(agent.id);
                  const isWinner = bid?.status === 'won';
                  const hasBid = bid && bid.status !== 'skipped' && bid.amount != null;

                  return (
                    <td
                      key={agent.id}
                      className={`text-right px-2 py-1.5 ${
                        isWinner
                          ? 'text-emerald-400 font-bold bg-emerald-900/15'
                          : hasBid
                            ? 'text-neutral-400'
                            : 'text-neutral-700'
                      }`}
                    >
                      {hasBid ? `$${bid!.amount!.toFixed(4)}` : '-'}
                    </td>
                  );
                })}
                <td className={`text-right px-2 py-1.5 text-[10px] tracking-wider ${
                  task.status === 'COMPLETED' ? 'text-emerald-500' : task.status === 'EXPIRED' ? 'text-red-400' : 'text-neutral-500'
                }`}>
                  {task.status}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AuctionRoundsTable() {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());

  useEffect(() => {
    async function fetchRounds() {
      try {
        const res = await fetch('/api/rounds?limit=20');
        const data = await res.json();
        if (data.success) {
          setRounds(data.rounds || []);
          // Auto-expand the most recent round
          if (data.rounds?.length > 0) {
            setExpandedRounds(new Set([data.rounds[0].round_number]));
          }
        } else {
          setError(data.error || 'Failed to fetch rounds');
        }
      } catch {
        setError('Failed to fetch rounds');
      } finally {
        setLoading(false);
      }
    }
    fetchRounds();
    const interval = setInterval(fetchRounds, 10_000);
    return () => clearInterval(interval);
  }, []);

  const toggleRound = (roundNumber: number) => {
    setExpandedRounds(prev => {
      const next = new Set(prev);
      if (next.has(roundNumber)) {
        next.delete(roundNumber);
      } else {
        next.add(roundNumber);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <Card className="mb-6">
        <div className="section-header">AUCTION ROUNDS</div>
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          LOADING<span className="animate-blink">_</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="mb-6">
        <div className="section-header">AUCTION ROUNDS</div>
        <div className="text-red-500 text-sm font-mono">ERROR: {error}</div>
      </Card>
    );
  }

  if (rounds.length === 0) {
    return (
      <Card className="mb-6">
        <div className="section-header">AUCTION ROUNDS</div>
        <div className="text-neutral-500 text-sm font-mono">
          NO ROUNDS YET — run a simulation to see results
        </div>
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <div className="section-header">AUCTION ROUNDS</div>
      <div className="space-y-1">
        {rounds.map((round) => {
          const expanded = expandedRounds.has(round.round_number);
          return (
            <div key={round.round_number} className="border border-neutral-800/50 rounded">
              <button
                onClick={() => toggleRound(round.round_number)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-elevated/50 transition-colors text-left"
              >
                <ChevronIcon open={expanded} />
                <span className="text-neutral-200 font-mono text-sm font-bold">
                  Round {round.round_number}
                </span>
                <span className="text-neutral-500 font-mono text-xs">
                  {round.summary.total_tasks} task{round.summary.total_tasks !== 1 ? 's' : ''}
                </span>
                <span className="text-neutral-600 font-mono text-xs">
                  {round.summary.total_bids} bid{round.summary.total_bids !== 1 ? 's' : ''}
                </span>
                <span className="ml-auto text-emerald-400 font-mono text-xs font-medium">
                  ${round.summary.revenue.toFixed(4)}
                </span>
                <span className={`text-[10px] font-mono ${round.summary.tasks_completed === round.summary.total_tasks ? 'text-emerald-500' : 'text-amber-400'}`}>
                  {round.summary.tasks_completed}/{round.summary.total_tasks} done
                </span>
              </button>

              {expanded && (
                <div className="border-t border-neutral-800/50">
                  <RoundBidMatrix round={round} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
