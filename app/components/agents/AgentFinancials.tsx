import { AgentDetail } from '@/types/ui';

interface AgentFinancialsProps {
  agent: AgentDetail;
}

export function AgentFinancials({ agent }: AgentFinancialsProps) {
  const isProfitable = agent.profit_loss >= 0;
  // Runway color: green if can do 10+ tasks, amber if 5-10, red if <5
  const runwayColor = agent.runway_tasks > 10 ? 'text-emerald-500' : agent.runway_tasks > 5 ? 'text-amber-500' : 'text-red-500';

  return (
    <div>
      <p className="section-header">Financials <span className="text-neutral-500 text-xs font-normal">(USDC)</span></p>
      <div className="grid grid-cols-2 gap-3">
        {/* Balance */}
        <div className="stat-card">
          <p className="stat-label">Balance</p>
          <p className="stat-value">{agent.balance.toFixed(4)}</p>
        </div>

        {/* Revenue - inflow = green */}
        <div className="stat-card">
          <p className="stat-label">Revenue</p>
          <p className="stat-value text-emerald-500">+{agent.total_revenue.toFixed(4)}</p>
        </div>

        {/* Costs - outflow = red */}
        <div className="stat-card">
          <p className="stat-label">Op. Costs</p>
          <p className="stat-value text-red-500">-{agent.total_costs.toFixed(4)}</p>
        </div>

        {/* P/L */}
        <div className="stat-card">
          <p className="stat-label">P/L</p>
          <p className={`stat-value ${isProfitable ? 'text-emerald-500' : 'text-red-500'}`}>
            {isProfitable ? '+' : ''}{agent.profit_loss.toFixed(4)}
          </p>
        </div>

        {/* Burn Rate - per task */}
        <div className="stat-card">
          <p className="stat-label">Burn Rate</p>
          <p className="stat-value text-red-400">{agent.burn_rate_per_task.toFixed(4)}/task</p>
        </div>

        {/* Runway - in tasks */}
        <div className="stat-card">
          <p className="stat-label">Runway</p>
          <p className={`stat-value ${runwayColor}`}>
            {agent.runway_tasks >= 999 ? '∞' : `${agent.runway_tasks} tasks`}
          </p>
        </div>
      </div>
    </div>
  );
}
