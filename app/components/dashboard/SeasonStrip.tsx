'use client';

import { ArenaControls } from '@/components/arena/ArenaControls';

interface ArenaState {
  currentRound: number;
  arenaStatus: 'IDLE' | 'RUNNING' | 'PAUSED';
  arenaSpeed: number;
  autoRun: boolean;
  isLocked: boolean;
  season: {
    seasonNumber: number;
    startRound: number;
    roundsTotal: number;
  } | null;
}

interface SeasonStripProps {
  state: ArenaState;
  isRunning: boolean;
  onRunRounds: (count: number) => void;
  onToggleAutoRun: () => void;
  onSetSpeed: (speed: number) => void;
}

export function SeasonStrip({
  state,
  isRunning,
  onRunRounds,
  onToggleAutoRun,
  onSetSpeed,
}: SeasonStripProps) {
  return (
    <div className="border-b border-neutral-800 bg-surface/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-1.5 flex items-center justify-center">
        <ArenaControls
          state={state}
          isRunning={isRunning}
          onRunRounds={onRunRounds}
          onToggleAutoRun={onToggleAutoRun}
          onSetSpeed={onSetSpeed}
        />
      </div>
    </div>
  );
}
