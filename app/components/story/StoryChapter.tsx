'use client';

import { ReactNode } from 'react';
import { useScrollReveal } from './useScrollReveal';

interface StoryChapterProps {
  children: ReactNode;
  className?: string;
  id?: string;
}

export function StoryChapter({ children, className = '', id }: StoryChapterProps) {
  const { ref, isVisible } = useScrollReveal(0.1);

  return (
    <section
      ref={ref}
      id={id}
      className={`story-reveal ${isVisible ? 'story-visible' : ''} ${className}`}
    >
      {children}
    </section>
  );
}
