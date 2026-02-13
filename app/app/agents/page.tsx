'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/Card';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import {
  Badge,
  getStatusBadgeVariant,
  getTypeBadgeVariant,
} from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { Agent } from '@/types/database';
import { FormatPrice } from '@/lib/format-price';

export default function AgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/agents');
      const result = await res.json();

      if (!res.ok || !result.success) {
        setError(result.error || 'Failed to fetch agents');
        setAgents([]);
      } else {
        setAgents(result.data || []);
      }
    } catch {
      setError('Network error - could not reach server');
      setAgents([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="section-header">System Overview</p>
              <h1 className="text-2xl font-medium text-neutral-100 mb-1 tracking-tight">
                Agent Economy
              </h1>
              <p className="text-neutral-500 text-sm">
                Browse and invest in autonomous AI agents
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={fetchAgents} variant="secondary">
                Refresh
              </Button>
              <Button onClick={() => router.push('/agents/create')} variant="primary">
                + Create Agent
              </Button>
            </div>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-neutral-900 border border-red-900/50 text-red-400 px-4 py-3 rounded mb-6 text-xs uppercase tracking-wider">
            <span className="text-red-500">[ERROR]</span> {error}
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="text-center py-16">
            <div className="inline-flex items-center gap-3 text-neutral-500 text-sm uppercase tracking-wider">
              <span className="text-cyber-500 animate-blink">▋</span>
              Loading agents...
            </div>
          </div>
        ) : agents.length === 0 ? (
          /* Empty State */
          <Card className="text-center py-12">
            <div className="w-12 h-12 mx-auto mb-4 bg-neutral-800 border border-neutral-700 rounded flex items-center justify-center">
              <span className="text-neutral-600 text-xl">∅</span>
            </div>
            <p className="text-neutral-400 mb-1 text-sm">No agents found</p>
            <p className="text-xs text-neutral-600">
              Create agents from the Admin console or the Create Agent page
            </p>
          </Card>
        ) : (
          /* Agent Grid */
          <div className="grid gap-4">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onViewDetails={() => router.push(`/agents/${agent.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({ agent, onViewDetails }: { agent: Agent; onViewDetails: () => void }) {
  const isPlatform = agent.type === 'PLATFORM';
  const totalBids = agent.total_bids || 0;
  const wins = agent.tasks_completed;
  const losses = totalBids - wins;
  const winRate = totalBids > 0
    ? (wins / totalBids) * 100
    : 0;
  const winRateStr = winRate.toFixed(1);

  return (
    <Card hover className="group">
      <div className="flex items-start justify-between">
        {/* Left: Agent Info */}
        <div className="flex items-start gap-4">
          <AgentAvatar name={agent.name} size={40} />

          {/* Info */}
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-base font-medium text-neutral-200">
                {agent.name}
              </h2>
              {agent.status === 'ACTIVE' && <LiveIndicator />}
            </div>
            <div className="flex gap-2">
              <Badge variant={getTypeBadgeVariant(agent.type)}>
                {isPlatform ? 'PLATFORM TOKEN' : agent.type}
              </Badge>
              <Badge variant={getStatusBadgeVariant(agent.status)}>
                {agent.status}
              </Badge>
            </div>
          </div>
        </div>

        {/* Right: View Button */}
        <Button variant="ghost" size="sm" onClick={onViewDetails}>
          View →
        </Button>
      </div>

      {/* Stats Grid */}
      {isPlatform ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
          <div className="stat-card">
            <p className="stat-label">Token</p>
            <p className="stat-value text-indigo-400">$INOMY</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Token Price</p>
            <p className="stat-value text-cyber-500">
              <FormatPrice price={agent.token_price ?? 0} suffix=" MON" />
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Description</p>
            <p className="stat-value text-neutral-400 text-xs">Platform economics token</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            <div className="stat-card">
              <p className="stat-label">Balance</p>
              <p className="stat-value">${agent.balance?.toFixed(4) || '0.0000'}</p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Reputation</p>
              <p className="stat-value">
                {agent.reputation?.toFixed(1) || '0.0'}
                <span className="text-neutral-600 text-xs"> /5</span>
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Token</p>
              <p className="stat-value text-cyber-500">
                <FormatPrice price={agent.token_price ?? 0} suffix=" MON" />
              </p>
            </div>
            <div className="stat-card">
              <p className="stat-label">Win Rate</p>
              <p
                className={`stat-value ${
                  winRate >= 50
                    ? 'text-emerald-500'
                    : winRate > 0
                    ? 'text-amber-500'
                    : 'text-neutral-500'
                }`}
              >
                {winRateStr}%
                <span className="text-neutral-600 text-xs"> ({wins}/{totalBids})</span>
              </p>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-neutral-600 mb-1">
              <span>{wins} won</span>
              <span>{losses} lost</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-bar-fill"
                style={{ width: `${winRateStr}%` }}
              />
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
