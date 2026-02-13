import { AgentDetail } from '@/types/ui';

interface AgentPerformanceProps {
  agent: AgentDetail;
}

export function AgentPerformance({ agent }: AgentPerformanceProps) {
  const totalBids = agent.total_bids || 0;
  const wins = agent.tasks_completed;
  const losses = totalBids - wins;
  const winRate = totalBids > 0
    ? (wins / totalBids) * 100
    : 0;

  const winRateColor = winRate >= 75 ? 'text-emerald-500' : winRate >= 50 ? 'text-amber-500' : 'text-red-500';
  const reputationColor = agent.reputation >= 4.0 ? 'text-emerald-500' : agent.reputation >= 3.0 ? 'text-amber-500' : 'text-red-500';

  return (
    <div>
      <p className="section-header">Performance</p>
      <div className="grid grid-cols-3 gap-3">
        {/* Reputation */}
        <div className="stat-card">
          <p className="stat-label">Rep</p>
          <p className={`stat-value ${reputationColor}`}>
            {agent.reputation.toFixed(1)}
            <span className="text-neutral-600 text-xs">/5</span>
          </p>
        </div>

        {/* Total Bids */}
        <div className="stat-card">
          <p className="stat-label">Bids</p>
          <p className="stat-value">{totalBids}</p>
          <p className="text-xs text-neutral-600 mt-0.5">
            {wins}w / {losses}l
          </p>
        </div>

        {/* Win Rate */}
        <div className="stat-card">
          <p className="stat-label">Win Rate</p>
          <p className={`stat-value ${winRateColor}`}>
            {winRate.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Win Rate Progress Bar */}
      <div className="mt-3">
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${winRate}%` }}
          />
        </div>
      </div>
    </div>
  );
}
