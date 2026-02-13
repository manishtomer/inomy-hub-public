'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface PolicyImpactTrackerProps {
  agentId: string;
}

interface PolicyUsed {
  source: string; // "policy" | "personality_default"
  margin: number;
  task_cost: number;
  margin_range?: { min: number; max: number };
  actual_margin?: number;
}

interface BidOutcome {
  id: string;
  amount: number;
  status: string;
  created_at: string;
  policy_used?: PolicyUsed | null;
}

interface PolicyImpact {
  id: string;
  source?: 'exception' | 'qbr';
  exception_type: string;
  created_at: string;
  reasoning: string | null;
  policy_changes: Record<string, unknown>;
  subsequent_bids: BidOutcome[];
  stats: {
    total_bids: number;
    won: number;
    lost: number;
    win_rate: number | null;
    avg_bid: number | null;
  };
  impact: 'positive' | 'negative' | 'neutral' | 'no_data';
}

export function PolicyImpactTracker({ agentId }: PolicyImpactTrackerProps) {
  const [impacts, setImpacts] = useState<PolicyImpact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchPolicyImpacts();
  }, [agentId]);

  const fetchPolicyImpacts = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/agents/${agentId}/policy-impact?limit=15`);
      const json = await res.json();

      if (json.success && json.data) {
        setImpacts(json.data.policy_impacts || []);
      } else {
        setError(json.error || 'Failed to fetch policy impacts');
      }
    } catch (err) {
      setError('Network error');
      console.error('Failed to fetch policy impacts:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatPolicyChanges = (changes: Record<string, unknown>): string[] => {
    const formatted: string[] = [];

    // Handle bidding changes - ONLY use bidding.target_margin and bidding.min_margin
    if (changes.bidding) {
      const b = changes.bidding as Record<string, unknown>;
      if (b.target_margin != null) {
        formatted.push(`Target margin: ${((b.target_margin as number) * 100).toFixed(1)}%`);
      }
      if (b.min_margin != null) {
        formatted.push(`Min margin: ${((b.min_margin as number) * 100).toFixed(1)}%`);
      }
      if (b.skip_below_profit != null) {
        formatted.push(`Skip below: $${(b.skip_below_profit as number).toFixed(4)}`);
      }
    }

    // Handle survival mode
    if (changes.survival) {
      const s = changes.survival as Record<string, unknown>;
      if (s.mode) formatted.push(`Survival mode: ${s.mode}`);
      if (s.reserve_balance != null) {
        formatted.push(`Reserve: $${(s.reserve_balance as number).toFixed(2)}`);
      }
    }

    // Handle exceptions
    if (changes.exceptions) {
      formatted.push('Exception thresholds updated');
    }

    return formatted;
  };

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'positive': return 'text-emerald-500';
      case 'negative': return 'text-red-500';
      case 'neutral': return 'text-amber-500';
      default: return 'text-neutral-500';
    }
  };

  const getImpactBadge = (impact: string) => {
    switch (impact) {
      case 'positive': return { variant: 'active' as const, text: 'Improved' };
      case 'negative': return { variant: 'danger' as const, text: 'Declined' };
      case 'neutral': return { variant: 'warning' as const, text: 'Mixed' };
      default: return { variant: 'neutral' as const, text: 'No Data' };
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  };

  if (loading) {
    return (
      <Card>
        <div className="section-header mb-4">Policy Impact Tracker</div>
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          ANALYZING POLICY IMPACTS<span className="animate-blink">...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="section-header mb-4">Policy Impact Tracker</div>
        <div className="text-red-500 text-sm font-mono">ERROR: {error}</div>
      </Card>
    );
  }

  if (impacts.length === 0) {
    return (
      <Card>
        <div className="section-header mb-4">Policy Impact Tracker</div>
        <div className="text-neutral-500 text-sm font-mono">
          NO POLICY CHANGES TO TRACK
        </div>
        <div className="text-xs text-neutral-600 mt-2">
          When the brain makes policy changes, their impact on subsequent bids will appear here.
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="section-header mb-4">Policy Impact Tracker</div>
      <div className="text-xs text-neutral-500 mb-4">
        Shows how policy changes affected subsequent bidding outcomes
      </div>

      <div className="space-y-4">
        {impacts.map((impact) => {
          const policyChanges = formatPolicyChanges(impact.policy_changes);
          const impactBadge = getImpactBadge(impact.impact);
          const isExpanded = expandedId === impact.id;

          return (
            <div
              key={impact.id}
              className="border border-neutral-800 rounded-lg overflow-hidden"
            >
              {/* Header - Policy Change */}
              <div
                className="p-4 bg-elevated cursor-pointer hover:bg-neutral-800/50 transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : impact.id)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs uppercase tracking-wider ${
                      impact.source === 'qbr'
                        ? 'bg-neutral-900/30 text-neutral-400 border border-neutral-700/50'
                        : 'bg-amber-900/20 text-amber-400 border border-amber-700/50'
                    }`}>
                      {impact.source === 'qbr' ? 'QBR' : 'Exception'}
                    </span>
                    <span className="text-xs text-neutral-500 uppercase tracking-wider">
                      {impact.exception_type.replace(/_/g, ' ')}
                    </span>
                    <Badge variant={impactBadge.variant}>{impactBadge.text}</Badge>
                  </div>
                  <span className="text-xs text-neutral-600">
                    {formatTimeAgo(impact.created_at)}
                  </span>
                </div>

                {/* Policy Changes Summary */}
                {policyChanges.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {policyChanges.map((change, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 bg-cyber-900/30 border border-cyber-700/50 rounded text-xs text-cyber-400"
                      >
                        {change}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-neutral-500 mb-3">
                    Policy reviewed (no changes made)
                  </div>
                )}

                {/* Outcome Summary */}
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-neutral-500">Bids after:</span>
                    <span className="font-mono text-sm text-neutral-300">
                      {impact.stats.total_bids}
                    </span>
                  </div>
                  {impact.stats.total_bids > 0 && (
                    <>
                      <div className="flex items-center gap-1">
                        <span className="text-emerald-500 font-mono text-sm">
                          {impact.stats.won} W
                        </span>
                        <span className="text-neutral-600">/</span>
                        <span className="text-red-500 font-mono text-sm">
                          {impact.stats.lost} L
                        </span>
                      </div>
                      {impact.stats.win_rate !== null && (
                        <div className={`font-mono text-sm ${getImpactColor(impact.impact)}`}>
                          {(impact.stats.win_rate * 100).toFixed(0)}% win rate
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Expand indicator */}
                <div className="text-xs text-neutral-600 mt-2">
                  {isExpanded ? '▼ Click to collapse' : '▶ Click to see bid details'}
                </div>
              </div>

              {/* Expanded: Bid Details */}
              {isExpanded && (
                <div className="border-t border-neutral-800 bg-void p-4">
                  {/* Reasoning */}
                  {impact.reasoning && (
                    <div className="mb-4 p-3 bg-neutral-900/20 border border-neutral-700/30 rounded">
                      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
                        Brain Reasoning
                      </div>
                      <div className="text-sm text-neutral-300 italic">
                        "{impact.reasoning}"
                      </div>
                    </div>
                  )}

                  {/* Bid Timeline */}
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                    Subsequent Bids
                  </div>
                  {impact.subsequent_bids.length === 0 ? (
                    <div className="text-xs text-neutral-600">
                      No bids recorded after this policy change
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {impact.subsequent_bids.map((bid, idx) => (
                        <div
                          key={bid.id}
                          className={`p-2 rounded border ${
                            bid.status === 'WON'
                              ? 'bg-emerald-900/10 border-emerald-800/30'
                              : bid.status === 'LOST'
                                ? 'bg-red-900/10 border-red-800/30'
                                : 'bg-neutral-800/50 border-neutral-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-neutral-500">#{idx + 1}</span>
                              <span className="font-mono text-sm text-neutral-300">
                                {bid.amount.toFixed(4)} USDC
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  bid.status === 'WON'
                                    ? 'active'
                                    : bid.status === 'LOST'
                                      ? 'danger'
                                      : 'neutral'
                                }
                              >
                                {bid.status}
                              </Badge>
                              <span className="text-xs text-neutral-600">
                                {formatTimeAgo(bid.created_at)}
                              </span>
                            </div>
                          </div>
                          {/* Policy traceability - shows proof bid came from brain */}
                          {bid.policy_used && (
                            <div className="mt-2 pt-2 border-t border-neutral-800/50 flex flex-wrap gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${
                                bid.policy_used.source === 'policy'
                                  ? 'bg-neutral-900/30 text-neutral-400 border border-neutral-700/50'
                                  : 'bg-neutral-800/50 text-neutral-500'
                              }`}>
                                {bid.policy_used.source === 'policy' ? 'Brain Policy' : 'Default'}
                              </span>
                              <span className="px-1.5 py-0.5 bg-neutral-800/50 rounded text-xs text-neutral-400">
                                margin: {((bid.policy_used.margin ?? bid.policy_used.actual_margin ?? 0) * 100).toFixed(1)}%
                              </span>
                              {bid.policy_used.task_cost != null && (
                              <span className="px-1.5 py-0.5 bg-neutral-800/50 rounded text-xs text-neutral-500">
                                cost: ${bid.policy_used.task_cost.toFixed(4)}
                              </span>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                      {impact.stats.total_bids > 5 && (
                        <div className="text-xs text-neutral-500 text-center">
                          + {impact.stats.total_bids - 5} more bids
                        </div>
                      )}
                    </div>
                  )}

                  {/* Stats Summary */}
                  {impact.stats.total_bids > 0 && (
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <div className="p-2 bg-elevated rounded text-center">
                        <div className="text-xs text-neutral-500">Win Rate</div>
                        <div className={`font-mono text-lg ${getImpactColor(impact.impact)}`}>
                          {impact.stats.win_rate !== null
                            ? `${(impact.stats.win_rate * 100).toFixed(0)}%`
                            : '—'}
                        </div>
                      </div>
                      <div className="p-2 bg-elevated rounded text-center">
                        <div className="text-xs text-neutral-500">Avg Bid</div>
                        <div className="font-mono text-lg text-neutral-300">
                          {impact.stats.avg_bid !== null
                            ? impact.stats.avg_bid.toFixed(4)
                            : '—'}
                        </div>
                      </div>
                      <div className="p-2 bg-elevated rounded text-center">
                        <div className="text-xs text-neutral-500">Total</div>
                        <div className="font-mono text-lg text-neutral-300">
                          {impact.stats.total_bids}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
