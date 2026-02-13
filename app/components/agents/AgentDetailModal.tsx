'use client';

import { useMemo, useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Agent } from '@/types/database';
import { AgentDetailHeader } from './AgentDetailHeader';
import { AgentFinancials } from './AgentFinancials';
import { AgentPerformance } from './AgentPerformance';
import { AgentInvestment } from './AgentInvestment';
import { AgentActivity } from './AgentActivity';
import { AgentThinking } from './AgentThinking';
import type { AgentDetail, AgentActivity as AgentActivityType } from '@/types/ui';

interface AgentDetailModalProps {
  agent: Agent | null;
  isOpen: boolean;
  onClose: () => void;
}

export function AgentDetailModal({ agent, isOpen, onClose }: AgentDetailModalProps) {
  const [detailData, setDetailData] = useState<Record<string, unknown> | null>(null);

  // Fetch extended details from API
  useEffect(() => {
    if (!agent || !isOpen) {
      setDetailData(null);
      return;
    }

    fetch(`/api/agents/${agent.id}?include_details=true`)
      .then((res) => res.json())
      .then((json) => {
        if (json.success && json.data) {
          setDetailData(json.data);
        }
      })
      .catch(() => {
        // Silently fail - will show basic data
      });
  }, [agent, isOpen]);

  // Build agent detail from API response or compute locally
  const agentDetail: AgentDetail | null = useMemo(() => {
    if (!agent) return null;

    if (detailData) {
      return detailData as unknown as AgentDetail;
    }

    // Fallback: compute basic financials locally
    const tasksCompleted = agent.tasks_completed || 0;
    const avgTaskRevenue = 0.15; // USDC per task
    const avgTaskCost = 0.06; // USDC per task (operational cost)
    const totalRevenue = agent.total_revenue || tasksCompleted * avgTaskRevenue;
    const totalCosts = tasksCompleted * avgTaskCost;
    const profitLoss = totalRevenue - totalCosts;
    // Burn rate per task = average operational cost per completed task
    const burnRatePerTask = tasksCompleted > 0 ? totalCosts / tasksCompleted : avgTaskCost;
    // Runway = how many tasks can be funded with current balance
    const runwayTasks = burnRatePerTask > 0 ? Math.floor(agent.balance / burnRatePerTask) : 999;

    return {
      ...agent,
      personality: 'balanced',
      total_revenue: totalRevenue,
      total_costs: totalCosts,
      profit_loss: profitLoss,
      burn_rate_per_task: burnRatePerTask,
      runway_tasks: Math.min(runwayTasks, 999),
      total_invested: 0,
      total_dividends: 0,
    };
  }, [agent, detailData]);

  // Extract activity and thinking from detail data
  const activities = useMemo((): AgentActivityType[] => {
    if (detailData && Array.isArray((detailData as Record<string, unknown>).activity)) {
      return (detailData as Record<string, unknown>).activity as AgentActivityType[];
    }
    return [];
  }, [detailData]);

  const thinking = useMemo(() => {
    if (detailData && Array.isArray((detailData as Record<string, unknown>).thinking)) {
      return (detailData as Record<string, unknown>).thinking as { timestamp: string; thought: string; context: string }[];
    }
    return [];
  }, [detailData]);

  if (!agentDetail) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="xl">
      <div className="space-y-6">
        {/* Header Section */}
        <AgentDetailHeader agent={agentDetail} />

        {/* Divider */}
        <div className="border-t border-neutral-800" />

        {/* Two-Column Layout for Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Financials */}
            <AgentFinancials agent={agentDetail} />

            {/* Performance */}
            <AgentPerformance agent={agentDetail} />
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Investment */}
            <AgentInvestment agent={agentDetail} />

            {/* Recent Activity */}
            <AgentActivity activities={activities} />
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-neutral-800" />

        {/* Agent Thinking Section - Full Width at Bottom */}
        <AgentThinking thinking={thinking} />
      </div>
    </Modal>
  );
}
