import { useState, useEffect, useRef, useCallback } from 'react';

interface UsePollingOptions {
  interval: number;           // ms between polls
  enabled?: boolean;          // toggle on/off (default: true)
  pauseWhenHidden?: boolean;  // stop when browser tab is hidden (default: true)
  onError?: (error: Error) => void;
}

interface UsePollingResult<T> {
  data: T | null;
  loading: boolean;           // true only on first load, NOT on subsequent polls
  error: string | null;
  lastUpdated: Date | null;
  isPolling: boolean;
  refresh: () => Promise<void>;   // manual refresh
  togglePolling: () => void;      // toggle auto-refresh on/off
}

export function usePolling<T>(
  fetcher: () => Promise<T>,
  options: UsePollingOptions
): UsePollingResult<T> {
  const {
    interval,
    enabled = true,
    pauseWhenHidden = true,
    onError,
  } = options;

  // State
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isPolling, setIsPolling] = useState(enabled);
  const [isVisible, setIsVisible] = useState(true);

  // Refs to avoid stale closures
  const fetcherRef = useRef(fetcher);
  const onErrorRef = useRef(onError);
  const intervalIdRef = useRef<NodeJS.Timeout | null>(null);
  const isFirstFetchRef = useRef(true);

  // Keep refs up to date
  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Handle visibility change
  useEffect(() => {
    if (!pauseWhenHidden) return;

    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pauseWhenHidden]);

  // Fetch function
  const fetch = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      setLastUpdated(new Date());

      // Only set loading to false after first successful fetch
      if (isFirstFetchRef.current) {
        setLoading(false);
        isFirstFetchRef.current = false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred';
      setError(errorMessage);

      // Call error handler if provided
      if (onErrorRef.current && err instanceof Error) {
        onErrorRef.current(err);
      }

      // Still set loading to false after first fetch, even on error
      if (isFirstFetchRef.current) {
        setLoading(false);
        isFirstFetchRef.current = false;
      }
    }
  }, []);

  // Manual refresh
  const refresh = useCallback(async () => {
    await fetch();
  }, [fetch]);

  // Toggle polling on/off
  const togglePolling = useCallback(() => {
    setIsPolling((prev) => !prev);
  }, []);

  // Polling effect
  useEffect(() => {
    // Determine if we should actually poll
    const shouldPoll = isPolling && (!pauseWhenHidden || isVisible);

    // Initial fetch on mount
    if (isFirstFetchRef.current) {
      fetch();
    }

    // Set up interval if polling is enabled
    if (shouldPoll && !isFirstFetchRef.current) {
      intervalIdRef.current = setInterval(() => {
        fetch();
      }, interval);
    }

    // Cleanup
    return () => {
      if (intervalIdRef.current) {
        clearInterval(intervalIdRef.current);
        intervalIdRef.current = null;
      }
    };
  }, [isPolling, isVisible, interval, fetch, pauseWhenHidden]);

  return {
    data,
    loading,
    error,
    lastUpdated,
    isPolling,
    refresh,
    togglePolling,
  };
}
