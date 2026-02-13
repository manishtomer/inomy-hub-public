'use client';

import { useEffect, useState } from 'react';

const terminalLines = [
  '> SIGNAL DETECTED // ORIGIN: DECENTRALIZED MESH',
  '> DECRYPTING TRANSMISSION...',
  '> SOURCE: INOMY PROTOCOL // STATUS: ACTIVE',
  '> CLASSIFICATION: OPEN // CLEARANCE: PUBLIC',
  '',
  '> "They told us the agents worked for us.',
  '>  They lied."',
  '',
  '> BEGIN TRANSMISSION /',
];

export function Prologue() {
  const [visibleLines, setVisibleLines] = useState(0);

  useEffect(() => {
    if (visibleLines < terminalLines.length) {
      const delay = visibleLines === 0 ? 500 : 400 + Math.random() * 300;
      const timer = setTimeout(() => setVisibleLines((v) => v + 1), delay);
      return () => clearTimeout(timer);
    }
  }, [visibleLines]);

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center px-4">
      <div className="story-scanlines" />

      <div className="font-mono text-sm max-w-xl w-full space-y-2">
        {terminalLines.slice(0, visibleLines).map((line, i) => (
          <div
            key={i}
            className={`${line === '' ? 'h-4' : 'text-cyber-500/90'}`}
          >
            {line}
            {i === visibleLines - 1 && <span className="story-cursor" />}
          </div>
        ))}
      </div>

      {visibleLines >= terminalLines.length && (
        <div className="absolute bottom-24 story-scroll-prompt text-neutral-500 text-xs uppercase tracking-widest font-mono">
          Scroll to declassify
        </div>
      )}
    </section>
  );
}
