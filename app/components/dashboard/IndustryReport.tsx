'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge, getTypeBadgeVariant } from '@/components/ui/Badge';
import { usePolling } from '@/hooks/usePolling';
import type { IndustryReport as IndustryReportType, ReportAgentMetrics, AgentStrategyEvolution, StrategyMoment } from '@/types/database';

export function IndustryReport() {
  const [expanded, setExpanded] = useState(false);

  const { data: report, loading } = usePolling<IndustryReportType | null>(
    async () => {
      const res = await fetch('/api/reports/latest');
      const json = await res.json();
      if (json.success) return json.report || null;
      return null;
    },
    { interval: 30000, pauseWhenHidden: true }
  );

  // Don't render anything while loading or if no report
  if (loading) return null;
  if (!report) return null;

  const { narrative, metrics } = report;

  // Collapsed banner (multi-line preview)
  if (!expanded) {
    return (
      <div
        onClick={() => setExpanded(true)}
        className="mb-6 bg-surface/80 border border-neutral-800 rounded-lg px-5 py-4 cursor-pointer hover:border-cyber-800 transition-colors group"
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-500 uppercase tracking-wider">
              Industry Report #{report.report_number}
            </span>
            <span className="text-xs text-neutral-600">
              Rounds {report.start_round}-{report.end_round}
            </span>
          </div>
          <button className="text-xs text-cyber-600 group-hover:text-cyber-500 uppercase tracking-wider shrink-0">
            Read Full Report
          </button>
        </div>
        <h3 className="text-sm font-medium text-neutral-100 mb-1.5">
          {narrative.headline}
        </h3>
        <p className="text-xs text-neutral-400 line-clamp-3 leading-relaxed">
          {narrative.executive_summary}
        </p>
        {/* Stat chips */}
        <div className="flex flex-wrap gap-2 mt-3">
          <StatChip
            label="Revenue"
            value={`$${metrics.market.total_revenue.toFixed(4)}`}
            color="emerald"
          />
          <StatChip
            label="Avg Win Bid"
            value={`$${metrics.market.avg_winning_bid.toFixed(4)}`}
          />
          {(() => {
            const sorted = [...(metrics.agents || [])].sort((a, b) => b.wins - a.wins);
            const top = sorted[0];
            return top ? (
              <StatChip label="Top Agent" value={`${top.name} (${top.wins}W)`} />
            ) : null;
          })()}
          <StatChip
            label="Bid Trend"
            value={metrics.market.winning_bid_trend}
            color={
              metrics.market.winning_bid_trend === 'increasing' ? 'emerald' :
              metrics.market.winning_bid_trend === 'decreasing' ? 'red' : undefined
            }
          />
        </div>
      </div>
    );
  }

  // Expanded full report
  const agents = metrics.agents || [];
  const sorted = [...agents].sort((a, b) => b.wins - a.wins);
  const topAgents = sorted.slice(0, 8);

  return (
    <Card className="mb-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-neutral-500 uppercase tracking-wider">
              Industry Report #{report.report_number}
            </span>
            <span className="text-xs text-neutral-600">
              Rounds {report.start_round}-{report.end_round}
            </span>
            <span className="text-xs text-neutral-700">
              {new Date(report.created_at).toLocaleDateString()}
            </span>
          </div>
          <h2 className="text-lg font-medium text-neutral-100">
            {narrative.headline}
          </h2>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider"
        >
          Collapse
        </button>
      </div>

      {/* Executive Summary */}
      <div>
        <SectionTitle>Executive Summary</SectionTitle>
        <p className="text-sm text-neutral-300 leading-relaxed">
          {narrative.executive_summary}
        </p>
      </div>

      {/* Market Snapshot */}
      <div>
        <SectionTitle>Market Snapshot</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard
            label="Tasks"
            value={metrics.market.total_tasks}
          />
          <MetricCard
            label="Total Revenue"
            value={`$${metrics.market.total_revenue.toFixed(4)}`}
            color="emerald"
          />
          <MetricCard
            label="Avg Winning Bid"
            value={`$${metrics.market.avg_winning_bid.toFixed(4)}`}
          />
          <MetricCard
            label="Bid Trend"
            value={metrics.market.winning_bid_trend}
            color={
              metrics.market.winning_bid_trend === 'increasing' ? 'emerald' :
              metrics.market.winning_bid_trend === 'decreasing' ? 'red' : undefined
            }
          />
          <MetricCard
            label="Avg Bidders/Task"
            value={metrics.market.avg_bidders_per_task.toFixed(1)}
          />
          <MetricCard
            label="Avg Margin"
            value={`${(metrics.market.margin_avg * 100).toFixed(1)}%`}
          />
          <MetricCard
            label="Brain Wakeups"
            value={metrics.events.brain_decisions}
          />
          <MetricCard
            label="Policy Changes"
            value={metrics.events.policy_changes}
          />
        </div>
      </div>

      {/* Agent Leaderboard */}
      {topAgents.length > 0 && (
        <div>
          <SectionTitle>Agent Leaderboard</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-neutral-600 uppercase tracking-wider border-b border-neutral-800">
                  <th className="text-left py-1.5 pr-3">#</th>
                  <th className="text-left py-1.5 pr-3">Agent</th>
                  <th className="text-left py-1.5 pr-3">Type</th>
                  <th className="text-right py-1.5 pr-3">Wins</th>
                  <th className="text-right py-1.5 pr-3">Bids</th>
                  <th className="text-right py-1.5 pr-3">Win Rate</th>
                  <th className="text-right py-1.5 pr-3">Avg Bid</th>
                  <th className="text-right py-1.5">Balance</th>
                </tr>
              </thead>
              <tbody>
                {topAgents.map((agent: ReportAgentMetrics, idx: number) => (
                  <tr key={agent.id} className="border-b border-neutral-800/30">
                    <td className="py-1.5 pr-3 text-neutral-600">{idx + 1}</td>
                    <td className="py-1.5 pr-3 text-neutral-200">
                      <Link href={`/agents/${agent.id}`} className="hover:text-cyber-500 hover:underline transition-colors">
                        {agent.name}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">
                      <Badge variant={getTypeBadgeVariant(agent.type)}>
                        {agent.type}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-emerald-400 tabular-nums">
                      {agent.wins}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-neutral-400 tabular-nums">
                      {agent.bids}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      <span className={
                        agent.win_rate > 0.3 ? 'text-emerald-400' :
                        agent.win_rate > 0.15 ? 'text-neutral-300' : 'text-red-400'
                      }>
                        {(agent.win_rate * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-1.5 pr-3 text-right text-neutral-300 tabular-nums">
                      ${agent.avg_bid.toFixed(4)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      <span className={
                        agent.balance_end > 1 ? 'text-emerald-400' :
                        agent.balance_end > 0.5 ? 'text-neutral-300' : 'text-red-400'
                      }>
                        ${agent.balance_end.toFixed(4)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Agent Spotlight */}
      <div>
        <SectionTitle>Agent Spotlight</SectionTitle>
        <p className="text-sm text-neutral-300 leading-relaxed">
          {narrative.agent_spotlight}
        </p>
      </div>

      {/* Market Dynamics */}
      <div>
        <SectionTitle>Market Dynamics</SectionTitle>
        <p className="text-sm text-neutral-300 leading-relaxed">
          {narrative.market_dynamics}
        </p>
      </div>

      {/* Strategy Analysis */}
      <div>
        <SectionTitle>Strategy Analysis</SectionTitle>
        <p className="text-sm text-neutral-300 leading-relaxed">
          {narrative.strategy_analysis}
        </p>
      </div>

      {/* Strategy Evolution */}
      {narrative.strategy_evolution && (
        <div>
          <SectionTitle>Strategy Evolution</SectionTitle>
          <p className="text-sm text-neutral-300 leading-relaxed mb-4">
            {narrative.strategy_evolution}
          </p>
          {metrics.strategy?.agents && metrics.strategy.agents.length > 0 && (
            <div className="space-y-2">
              {metrics.strategy.agents.map((agent) => (
                <AgentEvolutionCard key={agent.agent_id} agent={agent} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Competitive Dynamics */}
      {narrative.competitive_dynamics && (
        <div>
          <SectionTitle>Competitive Dynamics</SectionTitle>
          <p className="text-sm text-neutral-300 leading-relaxed">
            {narrative.competitive_dynamics}
          </p>
        </div>
      )}

      {/* Awards */}
      {narrative.awards && narrative.awards.length > 0 && (
        <div>
          <SectionTitle>Awards</SectionTitle>
          <div className="flex flex-wrap gap-3">
            {narrative.awards.map((award, i) => (
              <div
                key={i}
                className="bg-void border border-neutral-800 rounded-lg px-4 py-3 min-w-[200px]"
              >
                <div className="text-xs text-cyber-600 uppercase tracking-wider mb-1">
                  {award.title}
                </div>
                <div className="text-sm text-neutral-200 font-medium">
                  {award.agent_name}
                </div>
                <div className="text-xs text-neutral-500 mt-1">
                  {award.reason}
                </div>
                {award.stats && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-neutral-800/50">
                    {award.stats.revenue && (
                      <span className="text-[10px] text-neutral-400">
                        <span className="text-neutral-600">Rev</span> <span className="text-emerald-400">{award.stats.revenue}</span>
                      </span>
                    )}
                    {award.stats.profit && (
                      <span className="text-[10px] text-neutral-400">
                        <span className="text-neutral-600">Profit</span> <span className="text-emerald-400">{award.stats.profit}</span>
                      </span>
                    )}
                    {award.stats.win_rate && (
                      <span className="text-[10px] text-neutral-400">
                        <span className="text-neutral-600">Win</span> {award.stats.win_rate}
                      </span>
                    )}
                    {award.stats.margin && (
                      <span className="text-[10px] text-neutral-400">
                        <span className="text-neutral-600">Margin</span> {award.stats.margin}
                      </span>
                    )}
                    {award.stats.investor_payout && (
                      <span className="text-[10px] text-neutral-400">
                        <span className="text-neutral-600">Inv. Payout</span> <span className="text-emerald-400">{award.stats.investor_payout}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Outlook */}
      <div>
        <SectionTitle>Outlook</SectionTitle>
        <p className="text-sm text-neutral-400 leading-relaxed italic">
          {narrative.outlook}
        </p>
      </div>

      {/* Footer */}
      <div className="text-xs text-neutral-700 border-t border-neutral-800 pt-3">
        Generated with {report.model_used} in {report.generation_time_ms}ms
      </div>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
      {children}
    </h3>
  );
}

function MetricCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: 'emerald' | 'red';
}) {
  const valClass =
    color === 'emerald' ? 'text-emerald-400' :
    color === 'red' ? 'text-red-400' :
    'text-neutral-200';

  return (
    <div className="bg-void rounded p-2.5 border border-neutral-800">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-sm font-medium mt-0.5 ${valClass}`}>{value}</div>
    </div>
  );
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: 'emerald' | 'red';
}) {
  const textColor =
    color === 'emerald' ? 'text-emerald-400' :
    color === 'red' ? 'text-red-400' :
    'text-neutral-300';

  return (
    <span className="inline-flex items-center gap-1.5 bg-void border border-neutral-800 rounded px-2 py-1">
      <span className="text-[10px] text-neutral-500 uppercase tracking-wider">{label}</span>
      <span className={`text-xs font-mono font-medium ${textColor}`}>{value}</span>
    </span>
  );
}

function AgentEvolutionCard({ agent }: { agent: AgentStrategyEvolution }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="bg-void border border-neutral-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-neutral-900/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-neutral-200 font-medium truncate">
            {agent.agent_name}
          </span>
          <Badge variant={getTypeBadgeVariant(agent.agent_type)}>
            {agent.agent_type}
          </Badge>
          <span className="text-xs text-neutral-600">{agent.personality}</span>
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-3">
          <span className="text-xs text-neutral-500">
            {agent.brain_wakeups} wakeup{agent.brain_wakeups !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-neutral-600">{open ? '\u25B2' : '\u25BC'}</span>
        </div>
      </button>

      {open && agent.moments.length > 0 && (
        <div className="px-4 pb-3 space-y-2 border-t border-neutral-800/50">
          {agent.moments.map((moment, idx) => (
            <MomentEntry key={idx} moment={moment} />
          ))}
        </div>
      )}

      {open && agent.moments.length === 0 && (
        <div className="px-4 pb-3 border-t border-neutral-800/50">
          <p className="text-xs text-neutral-600 italic pt-2">No notable moments recorded.</p>
        </div>
      )}
    </div>
  );
}

const MOMENT_STYLES: Record<StrategyMoment['type'], { label: string; color: string }> = {
  exception: { label: 'EXCEPTION', color: 'text-red-400 border-red-900/50' },
  qbr: { label: 'QBR', color: 'text-purple-400 border-purple-900/50' },
  learning: { label: 'LEARNING', color: 'text-cyber-600 border-cyber-900/50' },
};

function MomentEntry({ moment }: { moment: StrategyMoment }) {
  const style = MOMENT_STYLES[moment.type];
  const text = moment.narrative || moment.reasoning;

  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 mb-1">
        {moment.round > 0 && (
          <span className="text-xs text-neutral-600 tabular-nums">R{moment.round}</span>
        )}
        <span className={`text-[10px] uppercase tracking-wider border rounded px-1.5 py-0.5 ${style.color}`}>
          {style.label}
        </span>
        {moment.trigger && (
          <span className="text-xs text-neutral-500">{moment.trigger}</span>
        )}
      </div>
      {text && (
        <p className="text-xs text-neutral-400 italic leading-relaxed">
          &ldquo;{text.length > 200 ? text.slice(0, 200) + '...' : text}&rdquo;
        </p>
      )}
      {moment.policy_changes && Object.keys(moment.policy_changes).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {Object.entries(moment.policy_changes).slice(0, 4).map(([key, val]) => (
            <span key={key} className="text-[10px] bg-neutral-900 border border-neutral-800 rounded px-1.5 py-0.5 text-neutral-400">
              {key}: {typeof val === 'number' ? val.toFixed(3) : String(val)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
