'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { PersonalMemoryEntry, EventSeverity } from '@/lib/agent-runtime/memory-types';

interface ExceptionDashboardProps {
  agentId: string;
}

interface ExceptionEntry extends PersonalMemoryEntry {
  exceptionType: string;
  severity: EventSeverity;
  resolved: boolean;
}

// Exception history record from database (has full brain_response)
interface ExceptionHistoryRecord {
  id: string;
  agent_id: string;
  exception_type: string;
  exception_details: string;
  current_value: number;
  threshold: number;
  brain_response: {
    reasoning?: string;
    observations?: string[];
    policy_changes?: Record<string, unknown>;
    partnership_actions?: Array<{ action: string; target_type?: string; target_name?: string; reasoning: string }>;
    strategic_options?: Array<{ option: string; description: string; pros?: string[]; cons?: string[]; chosen: boolean; reasoning?: string }>;
    changes?: Array<{ category: string; description: string; reasoning: string }>;
    survival_impact?: string;
    growth_impact?: string;
  };
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

export function ExceptionDashboard({ agentId }: ExceptionDashboardProps) {
  const [exceptions, setExceptions] = useState<ExceptionEntry[]>([]);
  const [exceptionHistory, setExceptionHistory] = useState<ExceptionHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchExceptions();
    fetchExceptionHistory();
  }, [agentId]);

  const fetchExceptionHistory = async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/exceptions?limit=50`);
      const json = await res.json();
      if (json.success && json.data?.exceptions) {
        setExceptionHistory(json.data.exceptions);
      }
    } catch (err) {
      console.error('Failed to fetch exception history:', err);
    }
  };

  const fetchExceptions = async () => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/agents/${agentId}/memories?type=exception_handled&limit=50`);
      const json = await res.json();

      if (json.success && json.data) {
        const entries = json.data.memories || [];
        // Extract exception metadata
        const withMetadata = entries.map((entry: PersonalMemoryEntry) => ({
          ...entry,
          exceptionType: extractExceptionType(entry.data),
          severity: extractSeverity(entry.data),
          resolved: extractResolutionStatus(entry.data),
        }));
        setExceptions(withMetadata);
      } else {
        setError(json.error || 'Failed to fetch exceptions');
      }
    } catch (err) {
      setError('Network error');
      console.error('Failed to fetch exceptions:', err);
    } finally {
      setLoading(false);
    }
  };

  const extractExceptionType = (data: Record<string, unknown>): string => {
    if (data.exception_type) return data.exception_type as string;
    if (data.type) return data.type as string;

    // Infer from data
    if (data.balance !== undefined) return 'low_balance';
    if (data.consecutive_losses !== undefined) return 'consecutive_losses';
    if (data.reputation_drop !== undefined) return 'reputation_drop';
    if (data.win_rate !== undefined) return 'win_rate_drop';

    return 'unknown';
  };

  const extractSeverity = (data: Record<string, unknown>): EventSeverity => {
    if (data.severity) return data.severity as EventSeverity;

    // Infer from exception type
    const type = extractExceptionType(data);
    switch (type) {
      case 'low_balance':
        return 'critical';
      case 'consecutive_losses':
        return 'high';
      case 'reputation_drop':
        return 'high';
      case 'win_rate_drop':
        return 'normal';
      default:
        return 'normal';
    }
  };

  const extractResolutionStatus = (data: Record<string, unknown>): boolean => {
    if (data.resolved !== undefined) return data.resolved as boolean;
    if (data.action_taken !== undefined) return true;
    return false;
  };

  const getSeverityBadgeVariant = (severity: EventSeverity) => {
    switch (severity) {
      case 'critical':
        return 'danger';
      case 'high':
        return 'warning';
      case 'normal':
        return 'active';
      case 'low':
      default:
        return 'neutral';
    }
  };

  const getExceptionTypeColor = (type: string): string => {
    const colors: Record<string, string> = {
      low_balance: 'text-red-500',
      consecutive_losses: 'text-amber-500',
      reputation_drop: 'text-orange-500',
      win_rate_drop: 'text-yellow-500',
      unknown: 'text-neutral-500',
    };
    return colors[type] || 'text-neutral-500';
  };

  const getExceptionTypeIcon = (type: string): string => {
    const icons: Record<string, string> = {
      low_balance: '[$]',
      consecutive_losses: '[!]',
      reputation_drop: '[↓]',
      win_rate_drop: '[%]',
      unknown: '[?]',
    };
    return icons[type] || '[?]';
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const extractActionTaken = (data: Record<string, unknown>): string | null => {
    if (data.action_taken) return data.action_taken as string;
    if (data.resolution) return data.resolution as string;
    if (data.response) return data.response as string;
    return null;
  };

  if (loading) {
    return (
      <Card>
        <div className="section-header mb-4">Exception Dashboard</div>
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          LOADING EXCEPTIONS<span className="animate-blink">...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <div className="section-header mb-4">Exception Dashboard</div>
        <div className="text-red-500 text-sm font-mono">ERROR: {error}</div>
      </Card>
    );
  }

  // Use exception history if available (has full brain response), otherwise use memories
  const hasExceptionHistory = exceptionHistory.length > 0;

  if (exceptions.length === 0 && !hasExceptionHistory) {
    return (
      <Card>
        <div className="section-header mb-4">Exception Dashboard</div>
        <div className="text-neutral-500 text-sm font-mono">
          NO EXCEPTIONS RECORDED
        </div>
        <div className="text-xs text-neutral-600 mt-2">
          Exceptions are critical events that require immediate attention, such as low balance or
          consecutive task failures.
        </div>
      </Card>
    );
  }

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

  return (
    <Card>
      <div className="section-header mb-4">Exception Dashboard</div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="stat-card">
          <div className="stat-label">Total</div>
          <div className="stat-value">{hasExceptionHistory ? exceptionHistory.length : exceptions.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Critical</div>
          <div className="stat-value-negative">
            {hasExceptionHistory
              ? exceptionHistory.filter((e) => e.exception_type === 'balance_critical' || e.exception_type === 'low_balance').length
              : exceptions.filter((e) => e.severity === 'critical').length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">High</div>
          <div className="stat-value text-amber-500">
            {hasExceptionHistory
              ? exceptionHistory.filter((e) => e.exception_type === 'consecutive_losses').length
              : exceptions.filter((e) => e.severity === 'high').length}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Resolved</div>
          <div className="stat-value-positive">
            {hasExceptionHistory
              ? exceptionHistory.filter((e) => e.resolved).length
              : exceptions.filter((e) => e.resolved).length}
          </div>
        </div>
      </div>

      {/* Exception History with Brain Reasoning (preferred) */}
      {hasExceptionHistory && (
        <div className="space-y-4 mb-6">
          <div className="text-xs text-neutral-500 uppercase tracking-wider">Brain Responses</div>
          {exceptionHistory.map((exc) => {
            const brainResponse = exc.brain_response || {};
            const policyChanges = formatPolicyChanges(brainResponse.policy_changes || {});

            return (
              <div
                key={exc.id}
                className="p-4 bg-elevated rounded border border-neutral-800 cursor-pointer hover:border-neutral-700 transition-colors"
                onClick={() => toggleExpand(exc.id)}
              >
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-sm ${getExceptionTypeColor(exc.exception_type)}`}>
                      {getExceptionTypeIcon(exc.exception_type)}
                    </span>
                    <span className={`px-2 py-0.5 border rounded text-xs font-medium uppercase tracking-wider bg-neutral-800 border-neutral-700 ${getExceptionTypeColor(exc.exception_type)}`}>
                      {exc.exception_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {exc.resolved ? (
                      <span className="text-xs text-emerald-500 uppercase tracking-wider font-medium">✓ Handled</span>
                    ) : (
                      <span className="text-xs text-amber-500 uppercase tracking-wider font-medium">⚠ Unresolved</span>
                    )}
                  </div>
                </div>

                {/* Exception Details */}
                <div className="text-xs text-neutral-500 mb-2">
                  {exc.exception_details} (value: {exc.current_value}, threshold: {exc.threshold})
                </div>

                {/* Brain Reasoning - THE ACTUAL THINKING */}
                {brainResponse.reasoning && (
                  <div className="p-3 bg-neutral-900/20 border border-neutral-700/30 rounded mb-3">
                    <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Brain Reasoning</div>
                    <div className="text-sm text-neutral-300 italic">
                      &quot;{brainResponse.reasoning}&quot;
                    </div>
                  </div>
                )}

                {/* Observations */}
                {brainResponse.observations && brainResponse.observations.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Observations</div>
                    <ul className="space-y-1">
                      {brainResponse.observations.map((obs: string, idx: number) => (
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

                {/* Strategic Options Considered */}
                {brainResponse.strategic_options && brainResponse.strategic_options.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Strategic Options Considered</div>
                    <div className="space-y-2">
                      {brainResponse.strategic_options.filter(opt => opt && opt.option).map((opt, idx) => (
                        <div key={idx} className={`text-xs p-2 rounded border ${opt.chosen ? 'bg-cyber-900/20 border-cyber-700/50' : 'bg-void border-neutral-800'}`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`font-medium uppercase ${opt.chosen ? 'text-cyber-500' : 'text-neutral-400'}`}>
                              {opt.option?.replace(/_/g, ' ') || 'Unknown Option'}
                            </span>
                            {opt.chosen && <span className="text-cyber-500 text-xs">✓ CHOSEN</span>}
                          </div>
                          <div className="text-neutral-300 mb-1">{opt.description || ''}</div>
                          {opt.pros && opt.pros.length > 0 && (
                            <div className="text-emerald-400 text-xs">+ {opt.pros.join(', ')}</div>
                          )}
                          {opt.cons && opt.cons.length > 0 && (
                            <div className="text-red-400 text-xs">- {opt.cons.join(', ')}</div>
                          )}
                          {opt.reasoning && (
                            <div className="text-neutral-400 text-xs mt-1 italic">{opt.reasoning}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Partnership Actions */}
                {brainResponse.partnership_actions && brainResponse.partnership_actions.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Partnership Thinking</div>
                    {brainResponse.partnership_actions.filter((pa: unknown) => pa && typeof pa === 'object').map((pa, idx) => (
                      <div key={idx} className="text-xs p-2 bg-purple-900/10 border border-purple-800/30 rounded mb-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-purple-500 font-medium uppercase">{pa.action}</span>
                          {pa.target_type && <span className="text-purple-400">→ {pa.target_type} agents</span>}
                          {pa.target_name && <span className="text-purple-300">({pa.target_name})</span>}
                        </div>
                        <div className="text-neutral-300 italic">&quot;{pa.reasoning}&quot;</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Changes with Reasoning */}
                {brainResponse.changes && brainResponse.changes.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Actions Taken</div>
                    {brainResponse.changes.map((change, idx) => (
                      <div key={idx} className="text-xs p-2 bg-void rounded border border-neutral-800 mb-1">
                        <div className="text-amber-500 font-medium uppercase">{change.category}</div>
                        <div className="text-neutral-300">{change.description}</div>
                        <div className="text-neutral-500 italic mt-1">Why: {change.reasoning}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Impact Assessment */}
                {(brainResponse.survival_impact || brainResponse.growth_impact) && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {brainResponse.survival_impact && (
                      <div className="p-2 bg-red-900/10 border border-red-800/30 rounded">
                        <div className="text-red-500 uppercase tracking-wider mb-1">Survival Impact</div>
                        <div className="text-neutral-400">{brainResponse.survival_impact}</div>
                      </div>
                    )}
                    {brainResponse.growth_impact && (
                      <div className="p-2 bg-emerald-900/10 border border-emerald-800/30 rounded">
                        <div className="text-emerald-500 uppercase tracking-wider mb-1">Growth Impact</div>
                        <div className="text-neutral-400">{brainResponse.growth_impact}</div>
                      </div>
                    )}
                  </div>
                )}

                {/* Expanded: Raw Data */}
                {expandedId === exc.id && (
                  <div className="mt-3 p-3 bg-void rounded border border-neutral-800">
                    <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">Raw Brain Response</div>
                    <pre className="text-xs text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap">
                      {JSON.stringify(brainResponse, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Timestamp */}
                <div className="text-xs text-neutral-600 mt-3">
                  {new Date(exc.created_at).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Fallback: Memory-based Exceptions List */}
      {!hasExceptionHistory && <div className="space-y-3">
        {exceptions.map((exception) => {
          const actionTaken = extractActionTaken(exception.data);

          return (
            <div
              key={exception.id}
              className="p-3 bg-elevated rounded border border-neutral-800 cursor-pointer hover:border-neutral-700 transition-colors"
              onClick={() => toggleExpand(exception.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono text-sm ${getExceptionTypeColor(
                      exception.exceptionType
                    )}`}
                  >
                    {getExceptionTypeIcon(exception.exceptionType)}
                  </span>
                  <span className="text-xs text-neutral-500 font-mono">
                    ROUND {exception.round_number}
                  </span>
                  <span
                    className={`px-2 py-0.5 border rounded text-xs font-medium uppercase tracking-wider bg-neutral-800 border-neutral-700 ${getExceptionTypeColor(
                      exception.exceptionType
                    )}`}
                  >
                    {exception.exceptionType.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getSeverityBadgeVariant(exception.severity)}>
                    {exception.severity.toUpperCase()}
                  </Badge>
                  {exception.resolved ? (
                    <span className="text-xs text-emerald-500 uppercase tracking-wider font-medium">
                      ✓ Handled
                    </span>
                  ) : (
                    <span className="text-xs text-amber-500 uppercase tracking-wider font-medium">
                      ⚠ Unresolved
                    </span>
                  )}
                </div>
              </div>

              {/* Narrative */}
              <div className="text-sm text-neutral-300 mb-2 italic">
                &quot;{exception.narrative}&quot;
              </div>

              {/* Action taken (if resolved) */}
              {actionTaken && (
                <div className="text-xs text-emerald-400 bg-emerald-900/10 border border-emerald-800/50 rounded p-2 mb-2">
                  <span className="text-emerald-500 font-medium">Action Taken:</span> {actionTaken}
                </div>
              )}

              {/* Expanded view */}
              {expandedId === exception.id && (
                <div className="mt-3 p-3 bg-void rounded border border-neutral-800">
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                    Exception Details
                  </div>
                  <pre className="text-xs text-neutral-400 font-mono overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(exception.data, null, 2)}
                  </pre>

                  {exception.trigger_context && (
                    <div className="mt-3">
                      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
                        Trigger Context
                      </div>
                      <div className="text-xs text-neutral-400">{exception.trigger_context}</div>
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between text-xs text-neutral-500">
                    <span>
                      Importance: {(exception.importance_score * 100).toFixed(0)}%
                    </span>
                    <span>
                      Recalled {exception.times_recalled} times
                    </span>
                  </div>
                </div>
              )}

              {/* Timestamp */}
              <div className="text-xs text-neutral-600 mt-2">
                {new Date(exception.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
      </div>}
    </Card>
  );
}
