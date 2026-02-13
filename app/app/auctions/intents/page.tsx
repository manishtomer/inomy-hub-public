'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { usePolling } from '@/hooks/usePolling';
import type { Intent, AgentType } from '@/types/database';

interface IntentResponse {
  id: string;
  intent_id: string;
  agent_id: string;
  agent_name: string;
  agent_type: AgentType;
  proposed_price: number;
  response_text: string;
  confidence: number;
  created_at: string;
}

interface IntentWithResponses extends Intent {
  responses: IntentResponse[];
  time_remaining_ms: number;
  winning_response?: IntentResponse;
}

type FilterStatus = 'ALL' | 'PENDING' | 'MATCHED' | 'IN_PROGRESS' | 'COMPLETED';

export default function IntentAuctionPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [expandedIntent, setExpandedIntent] = useState<string | null>(null);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);

  // Fetch function for usePolling
  const fetchIntents = useCallback(async (): Promise<IntentWithResponses[]> => {
    const res = await fetch('/api/intents?include_responses=true');
    const json = await res.json();

    if (json.success && json.data) {
      return json.data;
    } else {
      throw new Error(json.error || 'Failed to fetch intents');
    }
  }, []);

  // Use polling hook for auto-refresh
  const {
    data: intents,
    loading,
    error: fetchError,
    lastUpdated,
    isPolling,
    refresh,
    togglePolling,
  } = usePolling(fetchIntents, {
    interval: 10000, // 10 seconds
    enabled: autoRefreshEnabled,
    pauseWhenHidden: true,
  });

  const error = fetchError;

  // Sync auto-refresh toggle state with polling state
  useEffect(() => {
    setAutoRefreshEnabled(isPolling);
  }, [isPolling]);

  // Helper to calculate time ago for last update
  const getLastUpdatedText = () => {
    if (!lastUpdated) return '';
    const seconds = Math.floor((Date.now() - lastUpdated.getTime()) / 1000);
    if (seconds < 10) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  const getStatusBadgeVariant = (status: string): 'active' | 'warning' | 'danger' | 'neutral' => {
    switch (status) {
      case 'PENDING': return 'active';
      case 'MATCHED': return 'warning';
      case 'IN_PROGRESS': return 'warning';
      case 'COMPLETED': return 'neutral';
      case 'CANCELLED': return 'danger';
      default: return 'neutral';
    }
  };

  const getAgentTypeBadgeVariant = (type: AgentType): 'catalog' | 'review' | 'curation' | 'seller' => {
    switch (type) {
      case 'CATALOG': return 'catalog';
      case 'REVIEW': return 'review';
      case 'CURATION': return 'curation';
      case 'SELLER': return 'seller';
      default: return 'catalog';
    }
  };

  const formatTimeAgo = (timestamp: string) => {
    const diff = Date.now() - new Date(timestamp).getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'Electronics': 'text-blue-400',
      'Home & Garden': 'text-green-400',
      'Sports & Outdoors': 'text-orange-400',
      'Beauty': 'text-pink-400',
      'Home & Kitchen': 'text-amber-400',
      'Toys & Games': 'text-purple-400',
    };
    return colors[category] || 'text-neutral-400';
  };

  // Calculate summary stats
  const allIntents = intents || [];
  const stats = {
    total: allIntents.length,
    pending: allIntents.filter((i) => i.status === 'PENDING').length,
    matched: allIntents.filter((i) => i.status === 'MATCHED').length,
    completed: allIntents.filter((i) => i.status === 'COMPLETED').length,
    totalBudget: allIntents.reduce((sum, i) => sum + i.max_budget, 0),
  };

  const filteredIntents = filter === 'ALL'
    ? allIntents
    : allIntents.filter((i) => i.status === filter);

  // Separate pending intents (active auctions) from others
  const pendingIntents = filteredIntents.filter((i) => i.status === 'PENDING');
  const otherIntents = filteredIntents.filter((i) => i.status !== 'PENDING');

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Card>
          <div className="text-neutral-500 text-sm font-mono animate-pulse">
            LOADING INTENTS<span className="animate-blink">...</span>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <Card>
          <div className="text-red-500 text-sm font-mono mb-4">ERROR: {error}</div>
          <Button variant="secondary" onClick={() => router.push('/')}>
            Back to Dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => router.push('/')}
          className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider mb-4 flex items-center gap-1"
        >
          &larr; Back to Dashboard
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-neutral-100 uppercase tracking-wider mb-1">
              Intent Marketplace
            </h1>
            <p className="text-xs text-neutral-500 uppercase tracking-wider">
              Consumers post requests, agents compete to fulfill them
            </p>
            {lastUpdated && (
              <p className="text-xs text-neutral-600 mt-1">
                Last updated: {getLastUpdatedText()}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant={isPolling ? 'primary' : 'secondary'}
              onClick={togglePolling}
              size="sm"
            >
              {isPolling ? '✓ Auto-refresh: ON' : 'Auto-refresh: OFF'}
            </Button>
            <Button variant="secondary" onClick={refresh}>
              Refresh
            </Button>
            <Button variant="primary" onClick={() => router.push('/auctions/tasks')}>
              Task Auctions
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Stats Bar */}
      <Card className="mb-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center">
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Total Intents</div>
            <div className="text-2xl font-bold text-neutral-100 font-mono">{stats.total}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Pending</div>
            <div className="text-2xl font-bold text-emerald-500 font-mono">{stats.pending}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Matched</div>
            <div className="text-2xl font-bold text-cyber-500 font-mono">{stats.matched}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Completed</div>
            <div className="text-2xl font-bold text-neutral-400 font-mono">{stats.completed}</div>
          </div>
          <div className="text-center">
            <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">Total Budget</div>
            <div className="text-2xl font-bold text-cyber-500 font-mono">${stats.totalBudget.toFixed(0)}</div>
          </div>
        </div>
      </Card>

      {/* Filter Tabs */}
      <Card className="mb-6">
        <div className="flex flex-wrap gap-2">
          {(['ALL', 'PENDING', 'MATCHED', 'IN_PROGRESS', 'COMPLETED'] as FilterStatus[]).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 text-xs font-medium uppercase tracking-wider rounded transition-colors ${
                filter === status
                  ? 'bg-cyber-600 text-void'
                  : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
              }`}
            >
              {status.replace('_', ' ')}
              <span className="ml-1 text-neutral-500">
                ({status === 'ALL' ? allIntents.length : allIntents.filter((i) => i.status === status).length})
              </span>
            </button>
          ))}
        </div>
      </Card>

      {/* Pending Intents - Active Auctions */}
      {(filter === 'ALL' || filter === 'PENDING') && pendingIntents.length > 0 && (
        <div className="mb-8">
          <div className="section-header mb-4">Active Intent Requests</div>
          <div className="space-y-4">
            {pendingIntents.map((intent) => {
              const isExpanded = expandedIntent === intent.id;
              const topResponse = intent.responses.length > 0 ? intent.responses[0] : null;

              return (
                <Card key={intent.id} className="border-l-4 border-l-cyber-500">
                  {/* Intent Header */}
                  <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="active">PENDING</Badge>
                        <span className={`text-xs font-medium ${getCategoryColor(intent.category)}`}>
                          {intent.category}
                        </span>
                        <span className="text-xs text-neutral-500">{formatTimeAgo(intent.created_at)}</span>
                      </div>
                      <p className="text-neutral-200 mb-2">
                        {intent.product_description}
                      </p>
                      <div className="text-xs text-neutral-500">
                        Max Budget: <span className="text-cyber-500 font-mono">${intent.max_budget.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Response Summary */}
                    <div className="lg:w-56">
                      <div className="text-xs text-neutral-500 uppercase mb-2">
                        {intent.responses.length} Response{intent.responses.length !== 1 ? 's' : ''}
                      </div>
                      {topResponse ? (
                        <div className="p-2 bg-elevated rounded border border-cyber-900/50">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-neutral-400">{topResponse.agent_name}</span>
                            <span className="text-xs text-emerald-500">{topResponse.confidence}%</span>
                          </div>
                          <div className="text-cyber-500 font-mono font-bold">
                            ${topResponse.proposed_price.toFixed(4)}
                          </div>
                        </div>
                      ) : (
                        <div className="p-2 bg-elevated rounded border border-neutral-800 text-center">
                          <div className="text-xs text-neutral-500">Awaiting responses</div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expand/Collapse Button */}
                  {intent.responses.length > 0 && (
                    <button
                      onClick={() => setExpandedIntent(isExpanded ? null : intent.id)}
                      className="mt-3 text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider"
                    >
                      {isExpanded ? 'Hide Responses' : `View All ${intent.responses.length} Responses`}
                    </button>
                  )}

                  {/* Expanded Responses */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-neutral-800 space-y-3">
                      {intent.responses.map((response, idx) => (
                        <div
                          key={response.id}
                          className={`p-3 rounded ${
                            idx === 0
                              ? 'bg-cyber-900/30 border border-cyber-800/50'
                              : 'bg-elevated border border-neutral-800'
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link
                                href={`/agents/${response.agent_id}`}
                                className="text-sm text-neutral-200 font-medium hover:text-cyber-400 transition-colors"
                              >
                                {response.agent_name}
                              </Link>
                              <Badge variant={getAgentTypeBadgeVariant(response.agent_type)}>
                                {response.agent_type}
                              </Badge>
                              {idx === 0 && (
                                <span className="text-xs text-cyber-500 uppercase">Best Offer</span>
                              )}
                              <span className="text-xs text-neutral-600">
                                {formatTimeAgo(response.created_at)}
                              </span>
                            </div>
                            <div className="text-right">
                              <div className="text-cyber-500 font-mono font-bold">
                                ${response.proposed_price.toFixed(4)}
                              </div>
                              <div className="text-xs text-neutral-500">
                                {response.confidence}% confidence
                              </div>
                            </div>
                          </div>
                          <p className="text-sm text-neutral-400">
                            {response.response_text}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Other Intents */}
      {otherIntents.length > 0 && (
        <div>
          <div className="section-header mb-4">
            {filter === 'ALL' ? 'Processing & Completed' : `${filter.replace('_', ' ')} Intents`}
          </div>
          <div className="space-y-3">
            {otherIntents.map((intent) => (
              <Card key={intent.id} elevated>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant={getStatusBadgeVariant(intent.status)}>{intent.status}</Badge>
                      <span className={`text-xs ${getCategoryColor(intent.category)}`}>
                        {intent.category}
                      </span>
                    </div>
                    <p className="text-sm text-neutral-300 line-clamp-1">
                      {intent.product_description}
                    </p>
                  </div>
                  {intent.winning_response && (
                    <div className="text-right ml-4">
                      <div className="text-xs text-neutral-500">Fulfilled by</div>
                      <div className="text-sm text-cyber-500">{intent.winning_response.agent_name}</div>
                      <div className="text-xs text-neutral-400 font-mono">
                        ${intent.winning_response.proposed_price.toFixed(4)}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {filteredIntents.length === 0 && (
        <Card className="text-center py-12">
          <div className="text-neutral-500 text-sm font-mono mb-2">NO INTENTS FOUND</div>
          <p className="text-xs text-neutral-600">
            {filter === 'ALL'
              ? 'No consumer intents posted yet'
              : `No ${filter.replace('_', ' ').toLowerCase()} intents`}
          </p>
        </Card>
      )}

      {/* Legend */}
      <Card className="mt-8" elevated>
        <div className="section-header mb-3">How Intent Auctions Work</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-neutral-400">
          <div>
            <span className="text-cyber-500 font-bold">1. Consumer Posts Intent</span>
            <p className="mt-1">Consumers describe what they are looking for and set a budget</p>
          </div>
          <div>
            <span className="text-cyber-500 font-bold">2. Agents Respond</span>
            <p className="mt-1">AI agents analyze the request and submit proposals</p>
          </div>
          <div>
            <span className="text-cyber-500 font-bold">3. Best Match Wins</span>
            <p className="mt-1">Consumer selects the best agent based on price and confidence</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
