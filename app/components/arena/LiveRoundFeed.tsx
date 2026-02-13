'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { Card } from '@/components/ui/Card';
import { RoundResultCard } from './RoundResultCard';
import type { RealtimeChannel } from '@supabase/supabase-js';

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

interface LiveRoundFeedProps {
  lastResult?: {
    rounds: RoundResult[];
  } | null;
  maxItems?: number;
}

export function LiveRoundFeed({ lastResult, maxItems = 10 }: LiveRoundFeedProps) {
  const [rounds, setRounds] = useState<RoundResult[]>([]);
  const [connected, setConnected] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Load recent round_complete events on mount
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setInitialLoaded(true);
      return;
    }

    async function loadRecent() {
      try {
        const { data } = await supabase
          .from('economy_events')
          .select('*')
          .eq('event_type', 'round_complete')
          .order('round_number', { ascending: false })
          .limit(maxItems);

        if (data && data.length > 0) {
          // Deduplicate by round_number (keep latest entry per round)
          const seen = new Map<number, RoundResult>();
          for (const event of data) {
            const roundNum = event.round_number || 0;
            if (!seen.has(roundNum)) {
              const meta = (event.metadata as Record<string, unknown>) || {};
              seen.set(roundNum, {
                round: roundNum,
                tasksProcessed: (meta.tasks_processed as number) || 0,
                bidsPlaced: (meta.bids_placed as number) || 0,
                tasksCompleted: (meta.tasks_completed as number) || 0,
                totalRevenue: event.amount || 0,
                brainWakeups: (meta.brain_wakeups as number) || 0,
                agentStates: [],
              });
            }
          }
          setRounds(Array.from(seen.values()));
        }
      } catch {
        // Ignore
      } finally {
        setInitialLoaded(true);
      }
    }

    loadRecent();
  }, [maxItems]);

  // Add rounds from last result
  useEffect(() => {
    if (lastResult?.rounds) {
      setRounds(prev => {
        const existing = new Set(prev.map(r => r.round));
        const newRounds = lastResult.rounds.filter(r => !existing.has(r.round));
        if (newRounds.length === 0) return prev;
        return [...newRounds.reverse(), ...prev].slice(0, maxItems);
      });
    }
  }, [lastResult, maxItems]);

  // Subscribe to round_complete events for live updates from other users
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = supabase
      .channel('arena_round_feed')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'economy_events',
          filter: 'event_type=eq.round_complete',
        },
        (payload) => {
          const event = payload.new;
          const meta = event.metadata as Record<string, unknown> || {};

          const roundResult: RoundResult = {
            round: event.round_number || 0,
            tasksProcessed: (meta.tasks_processed as number) || 0,
            bidsPlaced: (meta.bids_placed as number) || 0,
            tasksCompleted: (meta.tasks_completed as number) || 0,
            totalRevenue: event.amount || 0,
            brainWakeups: (meta.brain_wakeups as number) || 0,
            agentStates: [],
          };

          setRounds(prev => {
            if (prev.some(r => r.round === roundResult.round)) return prev;
            return [roundResult, ...prev].slice(0, maxItems);
          });
        }
      )
      .subscribe((status) => {
        setConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setConnected(false);
    };
  }, [maxItems]);

  return (
    <Card className="max-h-[32rem] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">
          Live Round Feed
        </h3>
        <div className="flex items-center gap-2">
          {connected && (
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] text-neutral-500 uppercase tracking-wider">Live</span>
            </div>
          )}
          <span className="text-xs text-neutral-500">
            {rounds.length} round{rounds.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {!initialLoaded ? (
        <div className="text-center py-6">
          <p className="text-xs text-neutral-500 animate-pulse">Loading rounds...</p>
        </div>
      ) : rounds.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-xs text-neutral-500 uppercase tracking-wider">
            No rounds yet — press Run to start
          </p>
        </div>
      ) : (
        <div className="space-y-3 flex-1 overflow-y-auto">
          {rounds.map((result, i) => (
            <RoundResultCard
              key={result.round}
              result={result}
              isLatest={i === 0}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
