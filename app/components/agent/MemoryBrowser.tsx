'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type {
  IndustryMemoryEntry,
  PersonalMemoryEntry,
  IndustryEventType,
  PersonalMemoryType,
  EventSeverity,
} from '@/lib/agent-runtime/memory-types';

interface MemoryBrowserProps {
  agentId: string;
}

type TabType = 'industry' | 'personal';

export function MemoryBrowser({ agentId }: MemoryBrowserProps) {
  const [activeTab, setActiveTab] = useState<TabType>('industry');
  const [industryEvents, setIndustryEvents] = useState<IndustryMemoryEntry[]>([]);
  const [personalMemories, setPersonalMemories] = useState<PersonalMemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [industryTypeFilter, setIndustryTypeFilter] = useState<IndustryEventType | 'all'>('all');
  const [personalTypeFilter, setPersonalTypeFilter] = useState<PersonalMemoryType | 'all'>('all');
  const [fromRound, setFromRound] = useState<string>('');
  const [toRound, setToRound] = useState<string>('');

  // Expandable entries
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === 'industry') {
      fetchIndustryEvents();
    } else {
      fetchPersonalMemories();
    }
  }, [activeTab, industryTypeFilter, personalTypeFilter, fromRound, toRound, agentId]);

  const fetchIndustryEvents = async () => {
    try {
      setLoading(true);
      setError(null);

      let url = '/api/industry-events?limit=50';
      if (industryTypeFilter !== 'all') {
        url += `&type=${industryTypeFilter}`;
      }
      if (fromRound && toRound) {
        url += `&from_round=${fromRound}&to_round=${toRound}`;
      }

      const res = await fetch(url);
      const json = await res.json();

      if (json.success && json.data) {
        setIndustryEvents(json.data.events || []);
      } else {
        setError(json.error || 'Failed to fetch industry events');
      }
    } catch (err) {
      setError('Network error');
      console.error('Failed to fetch industry events:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPersonalMemories = async () => {
    try {
      setLoading(true);
      setError(null);

      let url = `/api/agents/${agentId}/memories?limit=50`;
      if (personalTypeFilter !== 'all') {
        url += `&type=${personalTypeFilter}`;
      }

      const res = await fetch(url);
      const json = await res.json();

      if (json.success && json.data) {
        setPersonalMemories(json.data.memories || []);
      } else {
        setError(json.error || 'Failed to fetch personal memories');
      }
    } catch (err) {
      setError('Network error');
      console.error('Failed to fetch personal memories:', err);
    } finally {
      setLoading(false);
    }
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

  const getEventTypeBadge = (eventType: IndustryEventType | PersonalMemoryType) => {
    const colors: Record<string, string> = {
      market_crash: 'bg-red-900/30 text-red-500 border-red-800/50',
      price_compression: 'bg-amber-900/30 text-amber-500 border-amber-800/50',
      demand_surge: 'bg-emerald-900/30 text-emerald-500 border-emerald-800/50',
      new_competitor_wave: 'bg-blue-900/30 text-blue-500 border-blue-800/50',
      partnership_trend: 'bg-purple-900/30 text-purple-500 border-purple-800/50',
      agent_death: 'bg-red-900/30 text-red-500 border-red-800/50',
      market_shift: 'bg-neutral-800 text-neutral-400 border-neutral-700',
      bid_outcome: 'bg-cyber-900/30 text-cyber-500 border-cyber-800/50',
      task_execution: 'bg-emerald-900/30 text-emerald-500 border-emerald-800/50',
      partnership_event: 'bg-purple-900/30 text-purple-500 border-purple-800/50',
      exception_handled: 'bg-amber-900/30 text-amber-500 border-amber-800/50',
      qbr_insight: 'bg-purple-900/30 text-purple-500 border-purple-800/50',
      learning: 'bg-blue-900/30 text-blue-500 border-blue-800/50',
      competitor_insight: 'bg-neutral-800 text-neutral-400 border-neutral-700',
    };

    return (
      <span
        className={`px-2 py-0.5 border rounded text-xs font-medium uppercase tracking-wider ${
          colors[eventType] || 'bg-neutral-800 text-neutral-400 border-neutral-700'
        }`}
      >
        {eventType.replace(/_/g, ' ')}
      </span>
    );
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const renderIndustryTab = () => (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={industryTypeFilter}
          onChange={(e) => setIndustryTypeFilter(e.target.value as IndustryEventType | 'all')}
          className="input text-xs"
        >
          <option value="all">All Event Types</option>
          <option value="market_crash">Market Crash</option>
          <option value="price_compression">Price Compression</option>
          <option value="demand_surge">Demand Surge</option>
          <option value="new_competitor_wave">New Competitor Wave</option>
          <option value="partnership_trend">Partnership Trend</option>
          <option value="agent_death">Agent Death</option>
          <option value="market_shift">Market Shift</option>
        </select>

        <input
          type="number"
          placeholder="From Round"
          value={fromRound}
          onChange={(e) => setFromRound(e.target.value)}
          className="input text-xs w-32"
        />

        <input
          type="number"
          placeholder="To Round"
          value={toRound}
          onChange={(e) => setToRound(e.target.value)}
          className="input text-xs w-32"
        />
      </div>

      {/* Events List */}
      {loading ? (
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          LOADING INDUSTRY EVENTS<span className="animate-blink">...</span>
        </div>
      ) : error ? (
        <div className="text-red-500 text-sm font-mono">ERROR: {error}</div>
      ) : industryEvents.length === 0 ? (
        <div className="text-neutral-500 text-sm font-mono">NO INDUSTRY EVENTS</div>
      ) : (
        <div className="space-y-3">
          {industryEvents.map((event) => (
            <div
              key={event.id}
              className="p-3 bg-elevated rounded border border-neutral-800 cursor-pointer hover:border-neutral-700 transition-colors"
              onClick={() => toggleExpand(event.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500 font-mono">
                    ROUND {event.round_number}
                  </span>
                  {getEventTypeBadge(event.event_type)}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={getSeverityBadgeVariant(event.severity)}>
                    {event.severity.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-neutral-500">
                    {event.agents_affected} agents affected
                  </span>
                </div>
              </div>

              <div className="text-sm text-neutral-300 mb-2">
                {event.narrative}
              </div>

              {expandedId === event.id && (
                <div className="mt-3 p-3 bg-void rounded border border-neutral-800">
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                    Structured Data
                  </div>
                  <pre className="text-xs text-neutral-400 font-mono overflow-x-auto">
                    {JSON.stringify(event.data, null, 2)}
                  </pre>
                </div>
              )}

              <div className="text-xs text-neutral-600 mt-2">
                {new Date(event.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderPersonalTab = () => (
    <div>
      {/* Filters */}
      <div className="mb-4">
        <select
          value={personalTypeFilter}
          onChange={(e) => setPersonalTypeFilter(e.target.value as PersonalMemoryType | 'all')}
          className="input text-xs"
        >
          <option value="all">All Memory Types</option>
          <option value="bid_outcome">Bid Outcome</option>
          <option value="task_execution">Task Execution</option>
          <option value="partnership_event">Partnership Event</option>
          <option value="exception_handled">Exception Handled</option>
          <option value="qbr_insight">QBR Insight</option>
          <option value="learning">Learning</option>
          <option value="competitor_insight">Competitor Insight</option>
        </select>
      </div>

      {/* Memories List */}
      {loading ? (
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          LOADING PERSONAL MEMORIES<span className="animate-blink">...</span>
        </div>
      ) : error ? (
        <div className="text-red-500 text-sm font-mono">ERROR: {error}</div>
      ) : personalMemories.length === 0 ? (
        <div className="text-neutral-500 text-sm font-mono">NO PERSONAL MEMORIES</div>
      ) : (
        <div className="space-y-3">
          {personalMemories.map((memory) => (
            <div
              key={memory.id}
              className="p-3 bg-elevated rounded border border-neutral-800 cursor-pointer hover:border-neutral-700 transition-colors"
              onClick={() => toggleExpand(memory.id)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500 font-mono">
                    ROUND {memory.round_number}
                  </span>
                  {getEventTypeBadge(memory.memory_type)}
                </div>
                <div className="flex items-center gap-2">
                  {/* Importance bar */}
                  <div className="w-20 h-2 bg-neutral-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        memory.importance_score >= 0.8
                          ? 'bg-red-500'
                          : memory.importance_score >= 0.5
                          ? 'bg-amber-500'
                          : 'bg-neutral-600'
                      }`}
                      style={{ width: `${memory.importance_score * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-neutral-500 font-mono">
                    {(memory.importance_score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <div className="text-sm text-neutral-300 mb-2 italic">
                &quot;{memory.narrative}&quot;
              </div>

              {expandedId === memory.id && (
                <div className="mt-3 p-3 bg-void rounded border border-neutral-800">
                  <div className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                    Structured Data
                  </div>
                  <pre className="text-xs text-neutral-400 font-mono overflow-x-auto">
                    {JSON.stringify(memory.data, null, 2)}
                  </pre>
                  {memory.trigger_context && (
                    <div className="mt-2">
                      <div className="text-xs text-neutral-500 uppercase tracking-wider mb-1">
                        Trigger Context
                      </div>
                      <div className="text-xs text-neutral-400">{memory.trigger_context}</div>
                    </div>
                  )}
                  <div className="mt-2 text-xs text-neutral-500">
                    Recalled {memory.times_recalled} times
                    {memory.last_recalled_at && (
                      <> · Last recalled: {new Date(memory.last_recalled_at).toLocaleString()}</>
                    )}
                  </div>
                </div>
              )}

              <div className="text-xs text-neutral-600 mt-2">
                {new Date(memory.created_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <Card>
      <div className="section-header mb-4">Memory Browser</div>

      {/* Tab Switcher */}
      <div className="flex gap-2 mb-4 border-b border-neutral-800">
        <button
          onClick={() => setActiveTab('industry')}
          className={`px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
            activeTab === 'industry'
              ? 'text-cyber-500 border-b-2 border-cyber-500'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Industry Memory
        </button>
        <button
          onClick={() => setActiveTab('personal')}
          className={`px-4 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
            activeTab === 'personal'
              ? 'text-cyber-500 border-b-2 border-cyber-500'
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Personal Memory
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'industry' ? renderIndustryTab() : renderPersonalTab()}
    </Card>
  );
}
