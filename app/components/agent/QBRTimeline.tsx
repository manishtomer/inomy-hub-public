'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import type { PersonalMemoryEntry } from '@/lib/agent-runtime/memory-types';

interface QBRTimelineProps {
  agentId: string;
}

interface QBREntry extends PersonalMemoryEntry {
  outcome?: 'positive' | 'neutral' | 'negative';
}

// QBR history record from database (has full brain reasoning)
interface QBRHistoryRecord {
  id: string;
  qbr_number: number;
  period: {
    rounds_since_last?: number;
    start_round?: number;
    end_round?: number;
  };
  input_metrics: {
    win_rate_start?: number;
    win_rate_end?: number;
    balance_start?: number;
    balance_end?: number;
    reputation_start?: number;
    reputation_end?: number;
  };
  decisions: {
    reasoning?: string;
    policy_changes?: Record<string, unknown>;
    partnership_actions?: Array<{ action: string; partner?: string; reasoning?: string }>;
    investor_update?: {
      observations?: string[];
      changes?: Array<{ category: string; description: string; reasoning: string }>;
      survival_impact?: string;
      growth_impact?: string;
    };
  };
  outcome?: {
    actual_win_rate?: number;
    actual_balance_change?: number;
    success?: boolean;
  };
  created_at: string;
}

export function QBRTimeline({ agentId }: QBRTimelineProps) {
  const [qbrEntries, setQbrEntries] = useState<QBREntry[]>([]);
  const [qbrHistory, setQbrHistory] = useState<QBRHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchQBRs();
    fetchQBRHistory();
  }, [agentId]);

  const fetchQBRHistory = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/qbr-history?limit=50`);
      const json = await res.json();
      if (json.success && json.data?.qbr_records) {
        setQbrHistory(json.data.qbr_records);
      }
    } catch (err) {
      console.error('Failed to fetch QBR history:', err);
    }
  };

  const fetchQBRs = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/agents/${agentId}/memories?type=qbr_insight&limit=50`);
      const json = await res.json();

      if (json.success && json.data) {
        const entries = json.data.memories || [];
        // Analyze outcome from data
        const withOutcome = entries.map((entry: PersonalMemoryEntry) => ({
          ...entry,
          outcome: determineOutcome(entry),
        }));
        setQbrEntries(withOutcome);
      } else {
        setError(json.error || 'Failed to fetch QBR history');
      }
    } catch (err) {
      setError('Network error');
      console.error('Failed to fetch QBRs:', err);
    } finally {
      setLoading(false);
    }
  };

  const determineOutcome = (entry: PersonalMemoryEntry): 'positive' | 'neutral' | 'negative' => {
    // Analyze the data to determine outcome
    const data = entry.data;

    // Check if there's a metrics change
    if (data.metrics_change) {
      const change = data.metrics_change as any;
      if (change.reputation_delta > 0 || change.profit_delta > 0) {
        return 'positive';
      }
      if (change.reputation_delta < 0 || change.profit_delta < 0) {
        return 'negative';
      }
    }

    // Check narrative sentiment
    const narrative = entry.narrative.toLowerCase();
    if (narrative.includes('improved') || narrative.includes('success') || narrative.includes('better')) {
      return 'positive';
    }
    if (narrative.includes('declined') || narrative.includes('worse') || narrative.includes('failed')) {
      return 'negative';
    }

    return 'neutral';
  };

  const getOutcomeColor = (outcome: 'positive' | 'neutral' | 'negative') => {
    switch (outcome) {
      case 'positive':
        return 'border-emerald-500 bg-emerald-900/10';
      case 'negative':
        return 'border-red-500 bg-red-900/10';
      case 'neutral':
      default:
        return 'border-amber-500 bg-amber-900/10';
    }
  };

  const getOutcomeDotColor = (outcome: 'positive' | 'neutral' | 'negative') => {
    switch (outcome) {
      case 'positive':
        return 'bg-emerald-500';
      case 'negative':
        return 'bg-red-500';
      case 'neutral':
      default:
        return 'bg-amber-500';
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const extractDecisions = (data: Record<string, unknown>): string[] => {
    const decisions: string[] = [];

    if (data.decisions) {
      const decisionData = data.decisions as any;
      if (Array.isArray(decisionData)) {
        return decisionData;
      }
      if (typeof decisionData === 'object') {
        Object.entries(decisionData).forEach(([key, value]) => {
          decisions.push(`${key}: ${value}`);
        });
      }
    }

    if (data.changes_made) {
      const changes = data.changes_made as any;
      if (Array.isArray(changes)) {
        decisions.push(...changes);
      }
    }

    return decisions;
  };

  // Helper to format policy changes for display
  const formatPolicyChanges = (changes: Record<string, unknown>): string[] => {
    const formatted: string[] = [];
    if (changes.bidding) {
      const b = changes.bidding as Record<string, unknown>;
      if (b.target_margin !== undefined) formatted.push(`Target margin → ${((b.target_margin as number) * 100).toFixed(0)}%`);
      if (b.min_margin !== undefined) formatted.push(`Min margin → ${((b.min_margin as number) * 100).toFixed(0)}%`);
    }
    if (changes.survival) {
      const s = changes.survival as Record<string, unknown>;
      if (s.mode) formatted.push(`Survival mode → ${s.mode}`);
    }
    if (changes.partnerships) {
      formatted.push('Partnership rules updated');
    }
    return formatted;
  };

  // Determine QBR outcome from history record
  const getQBROutcome = (record: QBRHistoryRecord): 'positive' | 'neutral' | 'negative' => {
    if (record.outcome?.success !== undefined) {
      return record.outcome.success ? 'positive' : 'negative';
    }
    const metrics = record.input_metrics;
    if (metrics.win_rate_end && metrics.win_rate_start) {
      if (metrics.win_rate_end > metrics.win_rate_start) return 'positive';
      if (metrics.win_rate_end < metrics.win_rate_start) return 'negative';
    }
    return 'neutral';
  };

  // Use qbrHistory if available (has full brain response)
  const hasQbrHistory = qbrHistory.length > 0;

  if (loading) {
    return (
      <Card>
        <div className="section-header mb-4">QBR Timeline</div>
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          LOADING QBR HISTORY<span className="animate-blink">...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="section-header mb-4">QBR Timeline</div>
        <div className="text-red-500 text-sm font-mono">ERROR: {error}</div>
      </Card>
    );
  }

  if (qbrEntries.length === 0 && !hasQbrHistory) {
    return (
      <Card>
        <div className="section-header mb-4">QBR Timeline</div>
        <div className="text-neutral-500 text-sm font-mono">
          NO QBR REVIEWS YET
        </div>
        <div className="text-xs text-neutral-600 mt-2">
          QBRs (Quarterly Business Reviews) are strategic reflection sessions where the agent
          analyzes its performance and adjusts its strategy.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="section-header mb-4">QBR Timeline</div>

      {/* QBR History with Brain Reasoning (preferred) */}
      {hasQbrHistory && (
        <div className="relative mb-6">
          {/* Vertical line */}
          <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-neutral-800" />

          <div className="space-y-6">
            {qbrHistory.map((qbr) => {
              const outcome = getQBROutcome(qbr);
              const decisions = qbr.decisions || {};
              const policyChanges = formatPolicyChanges(decisions.policy_changes || {});
              const investorUpdate = decisions.investor_update || {};

              return (
                <div key={qbr.id} className="relative pl-8">
                  {/* Timeline dot */}
                  <div className={`absolute left-0 top-1 w-6 h-6 rounded-full border-2 ${getOutcomeDotColor(outcome)} border-void`} />

                  {/* Content card */}
                  <div
                    className={`p-4 rounded border-l-4 cursor-pointer hover:bg-elevated transition-colors ${getOutcomeColor(outcome)}`}
                    onClick={() => toggleExpand(qbr.id)}
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
                          QBR #{qbr.qbr_number}
                          {qbr.period?.start_round && qbr.period?.end_round && (
                            <span className="ml-2 text-neutral-600">
                              (Rounds {qbr.period.start_round}-{qbr.period.end_round})
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-xs text-neutral-600">
                        {new Date(qbr.created_at).toLocaleDateString()}
                      </div>
                    </div>

                    {/* Metrics Summary */}
                    {qbr.input_metrics && (
                      <div className="grid grid-cols-3 gap-2 mb-3 p-2 bg-void rounded border border-neutral-800">
                        <div className="text-center">
                          <div className="text-xs text-neutral-500">Win Rate</div>
                          <div className={`text-sm font-mono ${
                            (qbr.input_metrics.win_rate_end || 0) > (qbr.input_metrics.win_rate_start || 0)
                              ? 'text-emerald-500'
                              : (qbr.input_metrics.win_rate_end || 0) < (qbr.input_metrics.win_rate_start || 0)
                              ? 'text-red-400'
                              : 'text-neutral-400'
                          }`}>
                            {((qbr.input_metrics.win_rate_end || 0) * 100).toFixed(0)}%
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-neutral-500">Balance Δ</div>
                          <div className={`text-sm font-mono ${
                            (qbr.input_metrics.balance_end || 0) > (qbr.input_metrics.balance_start || 0)
                              ? 'text-emerald-500'
                              : 'text-red-400'
                          }`}>
                            {((qbr.input_metrics.balance_end || 0) - (qbr.input_metrics.balance_start || 0)).toFixed(2)} USDC
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-xs text-neutral-500">Reputation</div>
                          <div className="text-sm font-mono text-neutral-400">
                            {(qbr.input_metrics.reputation_end || 0).toFixed(0)}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Brain Reasoning - THE ACTUAL THINKING */}
                    {decisions.reasoning && (
                      <div className="p-3 bg-neutral-900/20 border border-neutral-700/30 rounded mb-3">
                        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Brain Reasoning</div>
                        <div className="text-sm text-neutral-300 italic">
                          &quot;{decisions.reasoning}&quot;
                        </div>
                      </div>
                    )}

                    {/* Observations from investor update */}
                    {investorUpdate.observations && investorUpdate.observations.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Observations</div>
                        <ul className="space-y-1">
                          {investorUpdate.observations.map((obs: string, idx: number) => (
                            <li key={idx} className="text-xs text-neutral-400 flex items-start gap-2">
                              <span className="text-cyber-500 mt-0.5">•</span>
                              <span>{obs}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Policy Changes - WHAT THE BRAIN DECIDED */}
                    {policyChanges.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Policy Changes</div>
                        <ul className="space-y-1">
                          {policyChanges.map((change, idx) => (
                            <li key={idx} className="text-xs text-emerald-400 flex items-start gap-2">
                              <span className="text-emerald-500 mt-0.5">→</span>
                              <span>{change}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Partnership Actions */}
                    {decisions.partnership_actions && decisions.partnership_actions.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Partnership Actions</div>
                        {decisions.partnership_actions.map((action, idx) => (
                          <div key={idx} className="text-xs p-2 bg-void rounded border border-neutral-800 mb-1">
                            <div className="text-amber-500 font-medium uppercase">{action.action}</div>
                            {action.partner && <div className="text-neutral-300">Partner: {action.partner}</div>}
                            {action.reasoning && <div className="text-neutral-500 italic mt-1">Why: {action.reasoning}</div>}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Changes with Reasoning */}
                    {investorUpdate.changes && investorUpdate.changes.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Strategic Changes</div>
                        {investorUpdate.changes.map((change, idx) => (
                          <div key={idx} className="text-xs p-2 bg-void rounded border border-neutral-800 mb-1">
                            <div className="text-amber-500 font-medium uppercase">{change.category}</div>
                            <div className="text-neutral-300">{change.description}</div>
                            <div className="text-neutral-500 italic mt-1">Why: {change.reasoning}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Impact Assessment */}
                    {(investorUpdate.survival_impact || investorUpdate.growth_impact) && (
                      <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                        {investorUpdate.survival_impact && (
                          <div className="p-2 bg-red-900/10 border border-red-800/30 rounded">
                            <div className="text-red-500 uppercase tracking-wider mb-1">Survival Impact</div>
                            <div className="text-neutral-400">{investorUpdate.survival_impact}</div>
                          </div>
                        )}
                        {investorUpdate.growth_impact && (
                          <div className="p-2 bg-emerald-900/10 border border-emerald-800/30 rounded">
                            <div className="text-emerald-500 uppercase tracking-wider mb-1">Growth Impact</div>
                            <div className="text-neutral-400">{investorUpdate.growth_impact}</div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Outcome (if tracked) */}
                    {qbr.outcome && (
                      <div className="p-2 bg-void rounded border border-neutral-800 mb-3">
                        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Outcome</div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className={qbr.outcome.success ? 'text-emerald-500' : 'text-red-400'}>
                            {qbr.outcome.success ? '✓ Success' : '✗ Did not meet goals'}
                          </span>
                          {qbr.outcome.actual_win_rate !== undefined && (
                            <span className="text-neutral-400">Win rate: {(qbr.outcome.actual_win_rate * 100).toFixed(0)}%</span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Expanded: Raw Data */}
                    {expandedId === qbr.id && (
                      <div className="mt-3 p-3 bg-void rounded border border-neutral-800">
                        <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Raw QBR Data</div>
                        <pre className="text-xs text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap">
                          {JSON.stringify(qbr, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Fallback: Memory-based QBR Timeline */}
      {!hasQbrHistory && <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-neutral-800" />

        <div className="space-y-6">
          {qbrEntries.map((qbr) => {
            const decisions = extractDecisions(qbr.data);
            const trigger = qbr.data.trigger || qbr.trigger_context || 'Scheduled review';

            return (
              <div key={qbr.id} className="relative pl-8">
                {/* Timeline dot */}
                <div
                  className={`absolute left-0 top-1 w-6 h-6 rounded-full border-2 ${getOutcomeDotColor(
                    qbr.outcome || 'neutral'
                  )} border-void`}
                />

                {/* Content card */}
                <div
                  className={`p-4 rounded border-l-4 cursor-pointer hover:bg-elevated transition-colors ${getOutcomeColor(
                    qbr.outcome || 'neutral'
                  )}`}
                  onClick={() => toggleExpand(qbr.id)}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
                        ROUND {qbr.round_number} QBR
                      </div>
                      <div className="text-sm text-cyber-500 font-medium">
                        Triggered by: {trigger.toString()}
                      </div>
                    </div>
                    <div className="text-xs text-neutral-600">
                      {new Date(qbr.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Narrative */}
                  <div className="text-sm text-neutral-300 mb-3 italic">
                    &quot;{qbr.narrative}&quot;
                  </div>

                  {/* Key Decisions */}
                  {decisions.length > 0 && (
                    <div className="mb-3">
                      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                        Key Decisions
                      </div>
                      <ul className="space-y-1">
                        {decisions.slice(0, 3).map((decision, idx) => (
                          <li key={idx} className="text-xs text-neutral-400 flex items-start gap-2">
                            <span className="text-cyber-500 mt-0.5">&bull;</span>
                            <span>{decision}</span>
                          </li>
                        ))}
                        {decisions.length > 3 && !expandedId && (
                          <li className="text-xs text-neutral-500 italic">
                            +{decisions.length - 3} more decisions...
                          </li>
                        )}
                      </ul>
                    </div>
                  )}

                  {/* Expanded view */}
                  {expandedId === qbr.id && (
                    <div className="mt-4 p-3 bg-void rounded border border-neutral-800">
                      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                        Full Reasoning
                      </div>
                      <pre className="text-xs text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(qbr.data, null, 2)}
                      </pre>

                      {decisions.length > 3 && (
                        <div className="mt-3">
                          <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                            All Decisions
                          </div>
                          <ul className="space-y-1">
                            {decisions.slice(3).map((decision, idx) => (
                              <li key={idx} className="text-xs text-neutral-400 flex items-start gap-2">
                                <span className="text-cyber-500 mt-0.5">&bull;</span>
                                <span>{decision}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Importance indicator */}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="text-xs text-neutral-500">Importance:</div>
                    <div className="w-24 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all ${
                          qbr.importance_score >= 0.8
                            ? 'bg-red-500'
                            : qbr.importance_score >= 0.5
                            ? 'bg-amber-500'
                            : 'bg-neutral-600'
                        }`}
                        style={{ width: `${qbr.importance_score * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-neutral-500 font-mono">
                      {(qbr.importance_score * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>}
    </Card>
  );
}
