'use client';

import { Card } from '@/components/ui/Card';
// Uses Card component for layout

interface RoundAgentState {
  id: string;
  name: string;
  balance: number;
  reputation: number;
  status: string;
}

interface RoundResult {
  round: number;
  tasksProcessed: number;
  bidsPlaced: number;
  tasksCompleted: number;
  totalRevenue: number;
  brainWakeups: number;
  agentStates: RoundAgentState[];
}

interface RoundResultCardProps {
  result: RoundResult;
  isLatest?: boolean;
}

export function RoundResultCard({ result, isLatest = false }: RoundResultCardProps) {
  // Sort agents by balance descending to show winners at top
  const sortedAgents = [...result.agentStates].sort((a, b) => b.balance - a.balance);
  const topAgent = sortedAgents[0];

  return (
    <Card
      className={`transition-all duration-500 ${
        isLatest ? 'border-cyber-500/50 animate-fade-in' : 'opacity-80'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
            Round {result.round}
          </span>
          {isLatest && (
            <span className="text-[10px] text-cyber-500 bg-cyber-900/30 px-1.5 py-0.5 rounded uppercase tracking-wider">
              Latest
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span>{result.tasksCompleted}/{result.tasksProcessed} tasks</span>
          <span className="text-emerald-500">
            ${result.totalRevenue.toFixed(4)}
          </span>
          {result.brainWakeups > 0 && (
            <span className="text-amber-500">{result.brainWakeups} wakeup{result.brainWakeups > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* Top agent spotlight */}
      {topAgent && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-neutral-800/50 rounded">
          <span className="text-[10px] text-amber-500 uppercase tracking-wider">Top</span>
          <span className="text-xs text-neutral-200 font-medium">{topAgent.name}</span>
          <span className="text-xs text-emerald-500 font-mono">${topAgent.balance.toFixed(4)}</span>
        </div>
      )}

      {/* Agent states grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
        {sortedAgents.slice(0, 8).map((agent, i) => (
          <div
            key={agent.id}
            className={`flex items-center justify-between px-2 py-1 rounded text-xs ${
              i === 0 ? 'bg-emerald-900/10 border border-emerald-900/30' : 'bg-neutral-800/30'
            }`}
          >
            <span className="text-neutral-400 truncate mr-1">{agent.name}</span>
            <span className={`font-mono ${agent.balance > 0 ? 'text-neutral-300' : 'text-red-400'}`}>
              ${agent.balance.toFixed(2)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
