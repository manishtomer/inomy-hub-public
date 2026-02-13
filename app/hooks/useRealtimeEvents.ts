'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { EconomyEvent } from '@/types/database';
import type { RealtimeChannel } from '@supabase/supabase-js';

const MAX_EVENTS = 100;

interface UseRealtimeEventsResult {
  events: EconomyEvent[] | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
}

export function useRealtimeEvents(): UseRealtimeEventsResult {
  const [events, setEvents] = useState<EconomyEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Initial fetch
  const fetchInitial = useCallback(async () => {
    try {
      const res = await fetch('/api/events?limit=50');
      const json = await res.json();

      if (json.success && json.data) {
        setEvents(json.data as EconomyEvent[]);
        setError(null);
      } else {
        throw new Error(json.error || 'Failed to fetch events');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitial();

    if (!isSupabaseConfigured) return;

    // Subscribe to realtime INSERT events on economy_events
    const channel = supabase
      .channel('economy_events_realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'economy_events',
        },
        (payload) => {
          const newEvent = payload.new as EconomyEvent;
          setEvents((prev) => {
            if (!prev) return [newEvent];
            // Deduplicate by id
            if (prev.some((e) => e.id === newEvent.id)) return prev;
            // Prepend and cap at MAX_EVENTS
            return [newEvent, ...prev].slice(0, MAX_EVENTS);
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
  }, [fetchInitial]);

  return { events, loading, error, connected };
}
