'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge, getStatusBadgeVariant, getTypeBadgeVariant } from '@/components/ui/Badge';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { usePolling } from '@/hooks/usePolling';
import type { Agent } from '@/types/database';

const TYPE_FILTERS = ['ALL', 'REVIEW', 'CATALOG', 'CURATION', 'SELLER'] as const;
type TypeFilter = (typeof TYPE_FILTERS)[number];

interface AgentBusinessListProps {
  onAgentClick?: (agent: Agent) => void;
}

const PAGE_SIZE = 10;

export function AgentBusinessList({ onAgentClick }: AgentBusinessListProps) {
  const router = useRouter();
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('ALL');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: agents, loading, error, lastUpdated } = usePolling<Agent[]>(
    async () => {
      const res = await fetch('/api/agents');
      const json = await res.json();

      if (json.success && json.data) {
        return json.data;
      } else {
        throw new Error(json.error || 'Failed to fetch agents');
      }
    },
    {
      interval: 8000,
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

  const filteredAgents =
    agents && typeFilter !== 'ALL'
      ? agents.filter((a) => a.type === typeFilter)
      : agents;

  const displayedAgents = filteredAgents?.slice(0, visibleCount);
  const hasMore = (filteredAgents?.length || 0) > visibleCount;

  if (loading) {
    return (
      <Card>
        <div className="section-header">AGENT BUSINESSES</div>
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          LOADING<span className="animate-blink">&#x258B;</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="section-header">AGENT BUSINESSES</div>
        <div className="text-red-500 text-sm font-mono">ERROR: {error}</div>
      </Card>
    );
  }

  if (!agents || !agents.length) {
    return (
      <Card>
        <div className="section-header">AGENT BUSINESSES</div>
        <div className="text-neutral-500 text-sm font-mono">NO AGENTS</div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="section-header mb-0">AGENT BUSINESSES</div>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
        </div>
        <span className="text-xs text-neutral-600 font-mono">
          {lastUpdated && `Updated ${getTimeAgo(lastUpdated)}`}
        </span>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto">
        {TYPE_FILTERS.map((filter) => {
          const count =
            filter === 'ALL'
              ? agents.length
              : agents.filter((a) => a.type === filter).length;
          return (
            <button
              key={filter}
              onClick={() => { setTypeFilter(filter); setVisibleCount(PAGE_SIZE); }}
              className={`px-3 py-1 text-xs uppercase tracking-wider rounded transition-colors shrink-0 ${
                typeFilter === filter
                  ? 'bg-cyber-600 text-void font-medium'
                  : 'bg-void border border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700'
              }`}
            >
              {filter} <span className="text-[10px] opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Table layout */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-neutral-600 uppercase tracking-wider border-b border-neutral-800">
              <th className="text-left py-2 pr-3">Agent</th>
              <th className="text-left py-2 pr-3">Type</th>
              <th className="text-left py-2 pr-3">Status</th>
              <th className="text-right py-2 pr-3">Balance</th>
              <th className="text-right py-2 pr-3">Win Rate</th>
              <th className="text-right py-2 pr-3">Rep</th>
              <th className="text-right py-2 pr-3">Revenue</th>
              <th className="text-right py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {displayedAgents?.map((agent) => {
              const isDead = agent.status === 'DEAD';
              const totalBids = agent.total_bids || 0;
              const winRate =
                totalBids > 0
                  ? ((agent.tasks_completed / totalBids) * 100).toFixed(1)
                  : '0.0';
              const balance = agent.balance;

              return (
                <tr
                  key={agent.id}
                  className={`border-b border-neutral-800/30 ${
                    isDead ? 'opacity-50' : 'hover:bg-neutral-900/30'
                  }`}
                >
                  {/* Name */}
                  <td className="py-2.5 pr-3">
                    <Link
                      href={`/agents/${agent.id}`}
                      className={`flex items-center gap-2 font-medium hover:underline ${
                        isDead
                          ? 'text-neutral-500 line-through'
                          : 'text-neutral-200 hover:text-cyber-500'
                      }`}
                    >
                      <AgentAvatar name={agent.name} size={24} />
                      {agent.name}
                    </Link>
                  </td>

                  {/* Type */}
                  <td className="py-2.5 pr-3">
                    <Badge variant={getTypeBadgeVariant(agent.type)}>
                      {agent.type}
                    </Badge>
                  </td>

                  {/* Status */}
                  <td className="py-2.5 pr-3">
                    <Badge variant={getStatusBadgeVariant(agent.status)}>
                      {agent.status}
                    </Badge>
                  </td>

                  {/* Balance */}
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-neutral-300">
                    {agent.type === 'PLATFORM' ? '—' : `$${balance.toFixed(4)}`}
                  </td>

                  {/* Win Rate */}
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                    {agent.type === 'PLATFORM' ? '—' : (
                      <>
                        <span
                          className={
                            Number(winRate) > 30
                              ? 'text-emerald-400'
                              : Number(winRate) > 15
                              ? 'text-neutral-300'
                              : 'text-red-400'
                          }
                        >
                          {winRate}%
                        </span>
                        <span className="text-neutral-600 ml-1">
                          ({agent.tasks_completed}/{totalBids})
                        </span>
                      </>
                    )}
                  </td>

                  {/* Reputation */}
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-neutral-300">
                    {agent.type === 'PLATFORM' ? '—' : `${agent.reputation.toFixed(1)}/5`}
                  </td>

                  {/* Revenue */}
                  <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                    <span
                      className={
                        agent.total_revenue > 0
                          ? 'text-emerald-400'
                          : 'text-neutral-400'
                      }
                    >
                      {agent.total_revenue > 0 ? '+' : ''}
                      {agent.total_revenue.toFixed(4)}
                    </span>
                  </td>

                  {/* Actions */}
                  <td className="py-2.5 text-right">
                    <div className="flex gap-1.5 justify-end">
                      <button
                        onClick={() => router.push(`/agents/${agent.id}`)}
                        className="px-2 py-0.5 text-neutral-400 hover:text-neutral-200 border border-neutral-700 hover:border-neutral-600 rounded uppercase tracking-wider transition-colors"
                      >
                        Details
                      </button>
                      {!isDead && (
                        <button
                          onClick={() => onAgentClick?.(agent)}
                          className="px-2 py-0.5 text-void bg-cyber-600 hover:bg-cyber-500 rounded uppercase tracking-wider font-medium transition-colors"
                        >
                          Invest
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          className="w-full mt-3 py-2 text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider font-mono border border-neutral-800 hover:border-neutral-700 rounded transition-colors"
        >
          Show More ({(filteredAgents?.length || 0) - visibleCount} remaining)
        </button>
      )}
    </Card>
  );
}
