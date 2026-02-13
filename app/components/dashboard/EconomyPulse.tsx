'use client';

import { usePolling } from '@/hooks/usePolling';
import type { Agent } from '@/types/database';

interface PulseMetrics {
  activeAgents: number;
  totalRounds: number;
  tasksCompleted: number;
  totalRevenue: number;
  avgWinRate: number;
}

interface EconomyPulseProps {
  children?: React.ReactNode;
}

export function EconomyPulse({ children }: EconomyPulseProps) {
  const { data: agents } = usePolling<Agent[]>(
    async () => {
      const res = await fetch('/api/agents');
      const json = await res.json();
      if (json.success && json.data) return json.data;
      return [];
    },
    { interval: 8000, pauseWhenHidden: true }
  );

  const metrics: PulseMetrics = computeMetrics(agents);

  return (
    <div className="bg-surface border border-neutral-800 rounded-lg">
      <div className="px-5 py-3">
        <div className="flex items-center gap-6 overflow-x-auto">
          <PulseChip label="Active Agents" value={metrics.activeAgents} />
          <PulseChip label="Rounds" value={metrics.totalRounds} />
          <PulseChip label="Tasks Done" value={metrics.tasksCompleted} />
          <PulseChip
            label="Revenue"
            value={`$${metrics.totalRevenue.toFixed(4)}`}
            color="emerald"
          />
          <PulseChip
            label="Avg Win Rate"
            value={`${metrics.avgWinRate.toFixed(1)}%`}
          />
        </div>
      </div>
      {children && (
        <>
          <div className="border-t border-neutral-800" />
          <div className="px-5 py-3">
            {children}
          </div>
        </>
      )}
    </div>
  );
}

function computeMetrics(agents: Agent[] | null): PulseMetrics {
  if (!agents || agents.length === 0) {
    return {
      activeAgents: 0,
      totalRounds: 0,
      tasksCompleted: 0,
      totalRevenue: 0,
      avgWinRate: 0,
    };
  }

  const active = agents.filter((a) => a.status === 'ACTIVE' || a.status === 'LOW_FUNDS');
  const tasksCompleted = agents.reduce((sum, a) => sum + a.tasks_completed, 0);
  const totalRevenue = agents.reduce((sum, a) => sum + a.total_revenue, 0);

  // Total rounds = total bids (each agent bids once per round, so total bids ~ total agent-rounds)
  // Use max tasks_completed across agents as a proxy for rounds played
  const totalBids = agents.reduce((sum, a) => sum + (a.total_bids || 0), 0);
  const avgWinRate = totalBids > 0 ? (tasksCompleted / totalBids) * 100 : 0;

  // Rounds = total bids / number of active agents (each agent bids once per round)
  const agentCount = active.length || 1;
  const totalRounds = Math.round(totalBids / agentCount);

  return {
    activeAgents: active.length,
    totalRounds,
    tasksCompleted,
    totalRevenue,
    avgWinRate,
  };
}

function PulseChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: 'emerald';
}) {
  const valueColor = color === 'emerald' ? 'text-emerald-400' : 'text-neutral-100';

  return (
    <div className="flex flex-col items-start shrink-0">
      <span className="text-[10px] text-neutral-500 uppercase tracking-wider leading-tight">
        {label}
      </span>
      <span className={`text-lg font-mono font-medium leading-tight ${valueColor}`}>
        {value}
      </span>
    </div>
  );
}
