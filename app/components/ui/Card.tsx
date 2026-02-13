import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  glow?: boolean;
  gradient?: boolean;
  hover?: boolean;
  elevated?: boolean;
}

export function Card({
  children,
  className = '',
  glow = false,
  gradient = false,
  hover = false,
  elevated = false,
}: CardProps) {
  const baseClasses = elevated
    ? 'bg-elevated border border-neutral-800 rounded-lg p-5'
    : 'bg-surface border border-neutral-800 rounded-lg p-5';

  const glowClasses = glow
    ? 'hover:shadow-glow-amber transition-shadow duration-150'
    : '';

  const hoverClasses = hover
    ? 'hover:border-neutral-700 transition-colors duration-150 cursor-pointer'
    : '';

  const gradientClasses = gradient ? 'gradient-border' : '';

  return (
    <div
      className={`${baseClasses} ${glowClasses} ${hoverClasses} ${gradientClasses} ${className}`}
    >
      {children}
    </div>
  );
}
