'use client';

import { useEffect, useState } from 'react';

const DEMO_DURATION = 5 * 60; // 5 minutes in seconds

export function DemoTimer() {
  const [timeLeft, setTimeLeft] = useState(DEMO_DURATION);
  const [isRunning, setIsRunning] = useState(true);

  useEffect(() => {
    if (!isRunning || timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, timeLeft]);

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  const isUrgent = timeLeft < 60;

  const togglePause = () => {
    setIsRunning(!isRunning);
  };

  const reset = () => {
    setTimeLeft(DEMO_DURATION);
    setIsRunning(true);
  };

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <div className={`live-indicator ${!isRunning ? 'opacity-30' : ''}`} />
        <span className="text-xs text-neutral-500 uppercase tracking-wider">
          {isRunning ? 'LIVE' : 'PAUSED'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-neutral-500 uppercase tracking-wider">
          Demo Time:
        </span>
        <span
          className={`font-mono text-sm font-medium ${
            isUrgent
              ? 'text-red-500 animate-pulse'
              : timeLeft < 120
              ? 'text-amber-500'
              : 'text-neutral-300'
          }`}
        >
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={togglePause}
          className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider transition-colors"
        >
          {isRunning ? 'PAUSE' : 'RESUME'}
        </button>
        <button
          onClick={reset}
          className="text-xs text-neutral-500 hover:text-neutral-300 uppercase tracking-wider transition-colors"
        >
          RESET
        </button>
      </div>
    </div>
  );
}
