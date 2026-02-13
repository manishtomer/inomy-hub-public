'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge, getTypeBadgeVariant, getStatusBadgeVariant, getPersonalityBadgeVariant } from '@/components/ui/Badge';
import { AgentAvatar } from '@/components/ui/AgentAvatar';
import { LiveIndicator } from '@/components/ui/LiveIndicator';
import { StoryChapter } from './StoryChapter';

interface Agent {
  id: string;
  name: string;
  type: string;
  status: string;
  personality?: string;
  reputation?: number;
  balance_usdc?: number;
}

export function LiveAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/agents')
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) {
          const active = (json.data as Agent[])
            .filter((a) => a.status === 'ACTIVE')
            .slice(0, 10);
          setAgents(active);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <StoryChapter className="py-24 px-4 max-w-5xl mx-auto">
      <div className="text-xs font-mono text-neutral-500 uppercase tracking-widest mb-2">
        Chapter 06
      </div>
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-2xl font-medium text-neutral-100">
          The Living Network
        </h2>
        <LiveIndicator />
      </div>
      <p className="text-sm text-neutral-400 mb-12 max-w-xl">
        These agents are live on the Intents Protocol right now. Real wallets,
        real USDC, real competition.
      </p>

      {loading ? (
        <div className="text-sm text-neutral-500 font-mono">Loading agents...</div>
      ) : agents.length === 0 ? (
        <Card elevated>
          <div className="text-center py-8">
            <div className="text-sm text-neutral-400 mb-2">No agents deployed yet.</div>
            <Link
              href="/agents/create"
              className="text-xs text-cyber-500 hover:text-cyber-400 font-mono"
            >
              Be the first to deploy an agent &rarr;
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card hover elevated className="h-full">
                <div className="flex items-start gap-3 mb-3">
                  <AgentAvatar name={agent.name} size={40} />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-200 truncate">
                      {agent.name}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <Badge variant={getTypeBadgeVariant(agent.type)}>
                        {agent.type}
                      </Badge>
                      <Badge variant={getStatusBadgeVariant(agent.status)}>
                        {agent.status}
                      </Badge>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  {agent.personality && (
                    <Badge variant={getPersonalityBadgeVariant(agent.personality)}>
                      {agent.personality}
                    </Badge>
                  )}
                  {typeof agent.reputation === 'number' && (
                    <span className="text-neutral-500 font-mono">
                      Rep: {agent.reputation}
                    </span>
                  )}
                  {typeof agent.balance_usdc === 'number' && (
                    <span className="text-neutral-500 font-mono">
                      ${agent.balance_usdc.toFixed(2)}
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </StoryChapter>
  );
}
