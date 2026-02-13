'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { getExplorerTxUrl } from '@/lib/contracts';
import type { EconomyEvent } from '@/types/database';
import type { Address } from 'viem';

/**
 * Event tag config: label, text color, bg color, border color
 */
const EVENT_TAG: Record<string, { label: string; text: string; bg: string; border: string }> = {
  task_assigned: {
    label: 'WIN',
    text: 'text-amber-400',
    bg: 'bg-amber-900/20',
    border: 'border-amber-800/40',
  },
  task_payment: {
    label: 'PAYMENT',
    text: 'text-emerald-400',
    bg: 'bg-emerald-900/20',
    border: 'border-emerald-800/40',
  },
  cost_sink_payment: {
    label: 'OP COST',
    text: 'text-red-400',
    bg: 'bg-red-900/20',
    border: 'border-red-800/40',
  },
  living_cost: {
    label: 'LIVING COST',
    text: 'text-red-400',
    bg: 'bg-red-900/20',
    border: 'border-red-800/40',
  },
  bid_placed: {
    label: 'BID',
    text: 'text-sky-400',
    bg: 'bg-sky-900/20',
    border: 'border-sky-800/40',
  },
  task_completed: {
    label: 'COMPLETED',
    text: 'text-emerald-400',
    bg: 'bg-emerald-900/20',
    border: 'border-emerald-800/40',
  },
  investment: {
    label: 'INVEST',
    text: 'text-cyan-400',
    bg: 'bg-cyan-900/20',
    border: 'border-cyan-800/40',
  },
  partnership: {
    label: 'PARTNER',
    text: 'text-purple-400',
    bg: 'bg-purple-900/20',
    border: 'border-purple-800/40',
  },
  agent_death: {
    label: 'DEATH',
    text: 'text-red-500',
    bg: 'bg-red-900/20',
    border: 'border-red-800/40',
  },
  brain_decision: {
    label: 'THINKING',
    text: 'text-violet-400',
    bg: 'bg-violet-900/20',
    border: 'border-violet-800/40',
  },
};

const DEFAULT_TAG = {
  label: 'EVENT',
  text: 'text-neutral-400',
  bg: 'bg-neutral-900/20',
  border: 'border-neutral-800/40',
};

/** Filterable event type chips */
const FILTER_CHIPS: { key: string; label: string }[] = [
  { key: 'task_assigned', label: 'WIN' },
  { key: 'bid_placed', label: 'BID' },
  { key: 'task_payment', label: 'PAYMENT' },
  { key: 'cost_sink_payment', label: 'OP COST' },
  { key: 'living_cost', label: 'LIVING COST' },
  { key: 'brain_decision', label: 'THINKING' },
];

/**
 * Extract agent name from event metadata or description
 */
function getAgentName(event: EconomyEvent): string | null {
  const meta = (event.metadata || {}) as Record<string, unknown>;
  if (meta.agent_name) return meta.agent_name as string;

  // Try parsing from description
  const desc = event.description || '';
  // Common patterns: "AgentName won ...", "AgentName bid ...", "Paid AgentName ...", "AgentName paid ..."
  const patterns = [
    /^(.+?) won /,
    /^(.+?) bid /,
    /^(.+?) paid /,
    /^(.+?) living cost/,
    /^Paid (.+?) for/,
    /assigned to (.+?) for/,
  ];
  for (const p of patterns) {
    const m = desc.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Format event description with structured data from metadata
 */
function formatEventContent(event: EconomyEvent): {
  headline: string;
  details?: string;
  amountLabel?: string;
  amountClass?: string;
} {
  const meta = (event.metadata || {}) as Record<string, unknown>;

  switch (event.event_type) {
    case 'task_assigned': {
      const taskType = (meta.task_type as string) || '?';
      const totalBids = (meta.total_bids as number) || 0;
      const score = typeof meta.score === 'number' ? meta.score.toFixed(1) : '?';
      // Extract winner name from description: "Task X assigned to NAME for ..."
      const nameMatch = event.description?.match(/assigned to (.+?) for/);
      const winnerName = nameMatch?.[1] || 'Unknown';

      return {
        headline: `${winnerName} won ${taskType} auction`,
        details: `${totalBids} bid${totalBids !== 1 ? 's' : ''} · score ${score}`,
        amountLabel: event.amount ? `${event.amount.toFixed(4)} USDC` : undefined,
        amountClass: 'text-amber-400',
      };
    }

    case 'task_payment': {
      const taskType = (meta.task_type as string) || '?';
      // Extract agent name from description: "Operator paid NAME $X USDC ..."
      const nameMatch = event.description?.match(/paid (.+?) \$/);
      const agentName = nameMatch?.[1] || 'Agent';

      return {
        headline: `Paid ${agentName} for ${taskType} task`,
        details: 'x402 settlement',
        amountLabel: event.amount ? `+${event.amount.toFixed(4)} USDC` : undefined,
        amountClass: 'text-emerald-400',
      };
    }

    case 'cost_sink_payment': {
      const taskType = (meta.task_type as string) || '?';
      const nameMatch = event.description?.match(/^(.+?) paid/);
      const agentName = nameMatch?.[1] || 'Agent';

      return {
        headline: `${agentName} paid op. cost for ${taskType}`,
        details: 'ERC-20 transfer to sink',
        amountLabel: event.amount ? `-${event.amount.toFixed(4)} USDC` : undefined,
        amountClass: 'text-red-400',
      };
    }

    case 'living_cost': {
      const agentName = (meta.agent_name as string) || 'Agent';
      const round = meta.round as number;

      return {
        headline: `${agentName} living cost${round ? ` for round ${round}` : ''}`,
        details: 'infrastructure · storage · compute',
        amountLabel: event.amount ? `-${event.amount.toFixed(4)} USDC` : undefined,
        amountClass: 'text-red-400',
      };
    }

    case 'bid_placed': {
      const agentName = (meta.agent_name as string) || 'Agent';
      const taskType = (meta.task_type as string) || '?';
      const margin = meta.margin as number | undefined;

      return {
        headline: `${agentName} bid on ${taskType}`,
        details: margin != null ? `margin ${(margin * 100).toFixed(1)}%` : undefined,
        amountLabel: event.amount ? `${event.amount.toFixed(4)} USDC` : undefined,
        amountClass: 'text-sky-400',
      };
    }

    case 'task_completed': {
      return {
        headline: event.description || 'Task completed',
        amountLabel: event.amount ? `+${event.amount.toFixed(4)} USDC` : undefined,
        amountClass: 'text-emerald-400',
      };
    }

    case 'brain_decision': {
      const agentName = (meta.agent_name as string) || 'Agent';
      const trigger = (meta.trigger as string) || '';
      // The description already contains the reasoning in format: "AgentName: "reasoning...""
      // Extract just the reasoning part
      const reasoning = event.description?.replace(`${agentName}: `, '') || 'Thinking...';

      return {
        headline: `${agentName} ${trigger ? `(${trigger})` : ''}`,
        details: reasoning,
        amountClass: 'text-violet-400',
      };
    }

    default:
      return {
        headline: event.description || event.event_type,
        amountLabel: event.amount != null ? `${event.amount.toFixed(4)} USDC` : undefined,
        amountClass: 'text-neutral-300',
      };
  }
}

interface ActivityFeedProps {
  compact?: boolean;
}

export function ActivityFeed({ compact = false }: ActivityFeedProps) {
  const [newEventIds, setNewEventIds] = useState<Set<string>>(new Set());
  const prevEventsRef = useRef<EconomyEvent[]>([]);
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const { events, loading, error, connected } = useRealtimeEvents();

  // Detect new events for animation
  useEffect(() => {
    if (!events) return;

    if (prevEventsRef.current.length > 0) {
      const prevIds = new Set(prevEventsRef.current.map(e => e.id));
      const newIds = events
        .filter(e => !prevIds.has(e.id))
        .map(e => e.id);

      if (newIds.length > 0) {
        setNewEventIds(new Set(newIds));
        // Clear animation after 2 seconds
        setTimeout(() => setNewEventIds(new Set()), 2000);
      }
    }

    prevEventsRef.current = events;
  }, [events]);

  // Extract unique agent names from events
  const agentNames = useMemo(() => {
    if (!events) return [];
    const names = new Set<string>();
    for (const event of events) {
      const name = getAgentName(event);
      if (name) names.add(name);
    }
    return Array.from(names).sort();
  }, [events]);

  // Filter events
  const filteredEvents = useMemo(() => {
    if (!events) return [];
    let result = events.filter(e => {
      if (agentFilter !== 'all') {
        const name = getAgentName(e);
        if (name !== agentFilter) return false;
      }
      if (typeFilter !== 'all') {
        if (e.event_type !== typeFilter) return false;
      }
      return true;
    });
    if (compact) result = result.slice(0, 5);
    return result;
  }, [events, agentFilter, typeFilter, compact]);

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  const headerLabel = compact ? 'WHAT JUST HAPPENED' : 'LIVE ACTIVITY';

  if (loading && (!events || events.length === 0)) {
    return (
      <Card>
        <div className="section-header">{headerLabel}</div>
        <div className="text-neutral-500 text-sm font-mono animate-pulse">
          LOADING<span className="animate-blink">▋</span>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="section-header mb-0">{headerLabel}</div>
        <span className="flex items-center gap-1.5 text-xs font-mono">
          <span className={`inline-block w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-600'}`} />
          <span className={connected ? 'text-emerald-600' : 'text-neutral-600'}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </span>
      </div>

      {/* Filter bar — hidden in compact mode */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {/* Agent dropdown */}
          <select
            value={agentFilter}
            onChange={e => setAgentFilter(e.target.value)}
            className="bg-elevated border border-neutral-800 text-neutral-300 text-[11px] font-mono rounded px-2 py-1 focus:outline-none focus:border-neutral-600"
          >
            <option value="all">All Agents</option>
            {agentNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          {/* Event type chips */}
          <button
            onClick={() => setTypeFilter('all')}
            className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border transition-colors ${
              typeFilter === 'all'
                ? 'text-neutral-200 bg-neutral-700/50 border-neutral-600'
                : 'text-neutral-500 bg-neutral-900/30 border-neutral-800/40 hover:text-neutral-300'
            }`}
          >
            ALL
          </button>
          {FILTER_CHIPS.map(chip => {
            const tag = EVENT_TAG[chip.key] || DEFAULT_TAG;
            const active = typeFilter === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => setTypeFilter(active ? 'all' : chip.key)}
                className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border transition-colors ${
                  active
                    ? `${tag.text} ${tag.bg} ${tag.border}`
                    : 'text-neutral-500 bg-neutral-900/30 border-neutral-800/40 hover:text-neutral-300'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="text-red-500 text-sm font-mono mb-3">ERROR: {error}</div>
      )}

      {!filteredEvents || !filteredEvents.length ? (
        <div className="text-neutral-500 text-sm font-mono">
          {events && events.length > 0 ? 'NO MATCHING EVENTS' : 'NO ACTIVITY'}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {filteredEvents.map((event) => {
            const isNew = newEventIds.has(event.id);
            const tag = EVENT_TAG[event.event_type] || DEFAULT_TAG;
            const content = formatEventContent(event);
            // tx_hash: top-level field, or fallback to metadata for older records
            const meta = (event.metadata || {}) as Record<string, unknown>;
            const txHash = event.tx_hash || (meta.tx_hash as string) || (meta.cost_tx_hash as string) || null;

            return (
              <div
                key={event.id}
                className={`p-2.5 rounded font-mono text-xs transition-all duration-500 border ${
                  isNew
                    ? `${tag.bg} ${tag.border} animate-in slide-in-from-top-2`
                    : 'bg-elevated/50 border-transparent hover:bg-elevated'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {/* Timestamp */}
                  <span className="text-neutral-600 flex-shrink-0 pt-0.5">
                    {formatTimestamp(event.created_at)}
                  </span>

                  {/* Tag */}
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider border ${tag.text} ${tag.bg} ${tag.border}`}>
                    {tag.label}
                  </span>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="text-neutral-200">
                      {content.headline}
                    </div>
                    {content.details && (
                      <div className="text-neutral-500 mt-0.5">
                        {content.details}
                      </div>
                    )}
                  </div>

                  {/* Amount (links to tx explorer when tx_hash exists) */}
                  {content.amountLabel && (
                    <div className="flex-shrink-0">
                      {txHash ? (
                        <a
                          href={getExplorerTxUrl(txHash as Address)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`font-medium ${content.amountClass} hover:underline hover:brightness-125 transition-all cursor-pointer`}
                        >
                          {content.amountLabel}
                        </a>
                      ) : (
                        <span className={`font-medium ${content.amountClass}`}>
                          {content.amountLabel}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {compact && (
        <Link
          href="/arena"
          className="block mt-3 text-xs text-cyber-500 hover:text-cyber-400 font-medium uppercase tracking-wider transition-colors"
        >
          View All in Arena &rarr;
        </Link>
      )}
    </Card>
  );
}
