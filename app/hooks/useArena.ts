'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePolling } from './usePolling';

// ============================================================================
// TYPES
// ============================================================================

interface SeasonInfo {
  id: string;
  seasonNumber: number;
  startRound: number;
  endRound: number | null;
  status: 'ACTIVE' | 'COMPLETED';
  championAgentId: string | null;
  roundsCompleted: number;
  roundsTotal: number;
}

interface ArenaState {
  currentRound: number;
  arenaStatus: 'IDLE' | 'RUNNING' | 'PAUSED';
  arenaSpeed: number;
  autoRun: boolean;
  autoIntervalMs: number;
  roundsPerSeason: number;
  isLocked: boolean;
  lockHolder: string | null;
  lockExpiresAt: string | null;
  season: SeasonInfo | null;
}

interface RoundAgentState {
  id: string;
  name: string;
  balance: number;
  reputation: number;
  status: string;
}

interface RoundResult {
  round: number;
  tasksProcessed: number;
  bidsPlaced: number;
  tasksCompleted: number;
  totalRevenue: number;
  brainWakeups: number;
  agentStates: RoundAgentState[];
}

interface RunResult {
  rounds_completed: number;
  starting_round: number;
  ending_round: number;
  season: {
    id: string;
    number: number;
    roundsCompleted: number;
    roundsTotal: number;
  };
  totals: {
    tasks: number;
    bids: number;
    completed: number;
    revenue: number;
    wakeups: number;
  };
  rounds: RoundResult[];
}

interface UseArenaResult {
  state: ArenaState | null;
  loading: boolean;
  isRunning: boolean;
  lastResult: RunResult | null;
  error: string | null;
  runRounds: (count?: number, holder?: string) => Promise<RunResult | null>;
  toggleAutoRun: () => Promise<void>;
  setSpeed: (speed: number) => Promise<void>;
  refresh: () => Promise<void>;
}

// ============================================================================
// HOOK
// ============================================================================

const defaultState: ArenaState = {
  currentRound: 0,
  arenaStatus: 'IDLE',
  arenaSpeed: 1,
  autoRun: false,
  autoIntervalMs: 5000,
  roundsPerSeason: 50,
  isLocked: false,
  lockHolder: null,
  lockExpiresAt: null,
  season: null,
};

async function fetchArenaState(): Promise<ArenaState> {
  const res = await fetch('/api/arena/state');
  const json = await res.json();
  if (json.success && json.data) return json.data;
  throw new Error(json.error || 'Failed to fetch arena state');
}

export function useArena(): UseArenaResult {
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const autoRunRef = useRef<NodeJS.Timeout | null>(null);

  const {
    data: state,
    loading,
    error: pollError,
    refresh,
  } = usePolling<ArenaState>(fetchArenaState, {
    interval: 2000,
    enabled: true,
    pauseWhenHidden: true,
  });

  // Run N rounds (timeout scales with count: 60s per round)
  const runRounds = useCallback(async (count: number = 1, holder?: string): Promise<RunResult | null> => {
    if (isRunning) return null;
    setIsRunning(true);
    setRunError(null);

    const controller = new AbortController();
    const timeoutMs = Math.max(count * 60_000, 60_000); // 60s per round, min 60s
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('/api/arena/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rounds: count, holder }),
        signal: controller.signal,
      });

      const json = await res.json();

      if (!res.ok || !json.success) {
        const msg = json.error || `HTTP ${res.status}`;
        setRunError(msg);
        return null;
      }

      setLastResult(json.data);
      await refresh();
      return json.data;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Request timed out but server may still be processing
        setRunError(null);
        return null;
      }
      const msg = err instanceof Error ? err.message : 'Run failed';
      setRunError(msg);
      return null;
    } finally {
      clearTimeout(timeout);
      setIsRunning(false);
    }
  }, [isRunning, refresh]);

  // Toggle auto-run
  const toggleAutoRun = useCallback(async () => {
    const newAutoRun = !(state?.autoRun ?? false);

    try {
      await fetch('/api/arena/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_run: newAutoRun }),
      });
      await refresh();
    } catch (err) {
      console.error('[useArena] Toggle auto-run failed:', err);
    }
  }, [state?.autoRun, refresh]);

  // Set speed
  const setSpeed = useCallback(async (speed: number) => {
    try {
      await fetch('/api/arena/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_run: state?.autoRun ?? false,
          speed,
        }),
      });
      await refresh();
    } catch (err) {
      console.error('[useArena] Set speed failed:', err);
    }
  }, [state?.autoRun, refresh]);

  // Client-side auto-run interval
  useEffect(() => {
    if (state?.autoRun && !isRunning) {
      const interval = state.autoIntervalMs / (state.arenaSpeed || 1);

      autoRunRef.current = setInterval(() => {
        runRounds(1);
      }, interval);
    }

    return () => {
      if (autoRunRef.current) {
        clearInterval(autoRunRef.current);
        autoRunRef.current = null;
      }
    };
  }, [state?.autoRun, state?.autoIntervalMs, state?.arenaSpeed, isRunning, runRounds]);

  return {
    state: state || defaultState,
    loading,
    isRunning,
    lastResult,
    error: runError || pollError,
    runRounds,
    toggleAutoRun,
    setSpeed,
    refresh,
  };
}
