'use client';

import { useState, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { EconomyPulse } from '@/components/dashboard/EconomyPulse';
import { IndustryHeadline } from '@/components/dashboard/IndustryHeadline';
import { IndustryReport } from '@/components/dashboard/IndustryReport';
import { AgentBusinessList } from '@/components/dashboard/AgentBusinessList';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { InvestmentModal } from '@/components/investment/InvestmentModal';
import { ArenaControls } from '@/components/arena/ArenaControls';
import { useArena } from '@/hooks/useArena';
import type { Agent } from '@/types/database';

export default function Home() {
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showInvestModal, setShowInvestModal] = useState(false);
  const arena = useArena();
  const { wallets } = useWallets();
  const connectedWallet = wallets[0]?.address;
  const runRoundsWithWallet = useCallback(
    (count: number) => arena.runRounds(count, connectedWallet),
    [arena.runRounds, connectedWallet]
  );

  const handleAgentClick = (agent: Agent) => {
    setSelectedAgent(agent);
    setShowInvestModal(true);
  };

  return (
    <div className="min-h-screen bg-void">
      {/* Hero: Title + Value Prop + Action Cards */}
      <IndustryHeadline />

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">

        {/* Economy Stats + Simulation Controls — one unified card */}
        <EconomyPulse>
          {arena.state && (
            <div className="flex items-center justify-between gap-4">
              <div className="shrink-0">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider">
                  Simulation
                </span>
                <span className="text-[10px] text-neutral-600 ml-2">
                  — each round, agents bid on tasks, earn revenue, and pay costs
                </span>
              </div>
              <ArenaControls
                state={arena.state}
                isRunning={arena.isRunning}
                onRunRounds={runRoundsWithWallet}
                onToggleAutoRun={arena.toggleAutoRun}
                onSetSpeed={arena.setSpeed}
                error={arena.error}
                walletConnected={!!connectedWallet}
              />
            </div>
          )}
        </EconomyPulse>

        {/* Agent Businesses — hero table */}
        <div id="agents">
          <AgentBusinessList onAgentClick={handleAgentClick} />
        </div>

        {/* Live Section */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">
              Live This Round
            </h2>
            <div className="flex-1 h-px bg-neutral-800" />
          </div>
          <ActivityFeed compact />
        </div>

        {/* Analysis Section */}
        <div id="analysis">
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xs font-bold text-neutral-500 uppercase tracking-widest">
              Analysis
            </h2>
            <div className="flex-1 h-px bg-neutral-800" />
          </div>
          <IndustryReport />
        </div>
      </div>

      {/* Investment Modal */}
      <InvestmentModal
        agent={selectedAgent}
        isOpen={showInvestModal}
        onClose={() => setShowInvestModal(false)}
        onSuccess={() => setShowInvestModal(false)}
      />
    </div>
  );
}
