'use client';

import { Button } from '@/components/ui/Button';

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

interface ArenaControlsProps {
  state: ArenaState;
  isRunning: boolean;
  onRunRounds: (count: number) => void;
  onToggleAutoRun?: () => void;
  onSetSpeed?: (speed: number) => void;
  error?: string | null;
  walletConnected?: boolean;
}

export function ArenaControls({
  state,
  isRunning,
  onRunRounds,
  error,
  walletConnected = true,
}: ArenaControlsProps) {
  // Use server lock as source of truth — client isRunning may lag
  const busy = isRunning || state.isLocked;
  const disabled = busy || !walletConnected;

  const seasonTotal = state.season?.roundsTotal || 10;
  const seasonNumber = state.currentRound > 0
    ? Math.floor((state.currentRound - 1) / seasonTotal) + 1
    : 0;
  const seasonRound = state.currentRound > 0
    ? ((state.currentRound - 1) % seasonTotal) + 1
    : 0;
  const progressPct = seasonTotal > 0
    ? Math.min((seasonRound / seasonTotal) * 100, 100)
    : 0;

  const statusColor =
    state.arenaStatus === 'RUNNING'
      ? 'text-emerald-500'
      : state.arenaStatus === 'PAUSED'
      ? 'text-amber-500'
      : 'text-neutral-500';

  const statusDot =
    state.arenaStatus === 'RUNNING'
      ? 'bg-emerald-500 animate-pulse'
      : state.arenaStatus === 'PAUSED'
      ? 'bg-amber-500'
      : 'bg-neutral-600';

  return (
    <div className="flex items-center gap-4">
      {/* Season + Round Info */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className={`text-xs uppercase tracking-wider font-medium ${statusColor}`}>
            {state.arenaStatus}
          </span>
        </div>

        <div className="text-xs text-neutral-500 uppercase tracking-wider">
          {state.currentRound > 0 ? (
            <span>
              <span className="text-neutral-300">S{seasonNumber}</span>
              {' '}R{seasonRound}/{seasonTotal}
            </span>
          ) : (
            <span>Round {state.currentRound}</span>
          )}
        </div>

        {/* Mini progress bar */}
        {state.season && (
          <div className="w-16 h-1 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyber-500 transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-neutral-700" />

      {/* Run Buttons */}
      <div className="flex items-center gap-1">
        {!walletConnected ? (
          <span className="text-xs text-amber-500">Connect wallet to run rounds</span>
        ) : error ? (
          <span className="text-xs text-red-400 max-w-[260px] truncate">{error}</span>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onRunRounds(1)}
          disabled={disabled}
          loading={busy}
        >
          {busy ? 'Running...' : 'Run 1 Round'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRunRounds(5)}
          disabled={disabled}
        >
          Run 5
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRunRounds(10)}
          disabled={disabled}
        >
          Run 10
        </Button>
      </div>

    </div>
  );
}
