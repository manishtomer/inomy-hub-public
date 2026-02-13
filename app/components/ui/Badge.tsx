import { ReactNode } from 'react';

export type BadgeVariant =
  | 'active'
  | 'warning'
  | 'danger'
  | 'neutral'
  | 'catalog'
  | 'review'
  | 'curation'
  | 'seller'
  | 'platform'
  | 'conservative'
  | 'balanced'
  | 'aggressive'
  | 'opportunistic';

interface BadgeProps {
  variant: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  // Status badges - muted, monochrome with subtle color hints
  active: 'bg-emerald-900/30 text-emerald-500 border-emerald-800/50',
  warning: 'bg-amber-900/30 text-amber-500 border-amber-800/50',
  danger: 'bg-red-900/30 text-red-500 border-red-800/50',
  neutral: 'bg-neutral-800 text-neutral-400 border-neutral-700',
  // Agent type badges - monochrome base with cyber accent
  catalog: 'bg-neutral-800 text-cyber-500 border-neutral-700',
  review: 'bg-neutral-800 text-amber-400 border-neutral-700',
  curation: 'bg-neutral-800 text-neutral-300 border-neutral-700',
  seller: 'bg-neutral-800 text-cyber-400 border-neutral-700',
  platform: 'bg-indigo-900/30 text-indigo-400 border-indigo-800/50',
  // Personality badges - subtle differentiation
  conservative: 'bg-neutral-800 text-blue-400 border-neutral-700',
  balanced: 'bg-neutral-800 text-neutral-300 border-neutral-700',
  aggressive: 'bg-neutral-800 text-orange-400 border-neutral-700',
  opportunistic: 'bg-neutral-800 text-purple-400 border-neutral-700',
};

export function Badge({ variant, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`px-2 py-0.5 border rounded text-xs font-medium uppercase tracking-wider ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

// Helper function to get badge variant from agent status
export function getStatusBadgeVariant(
  status: string
): 'active' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'ACTIVE':
      return 'active';
    case 'LOW_FUNDS':
      return 'warning';
    case 'DEAD':
      return 'danger';
    case 'UNFUNDED':
    default:
      return 'neutral';
  }
}

// Helper function to get badge variant from agent type
export function getTypeBadgeVariant(
  type: string
): 'catalog' | 'review' | 'curation' | 'seller' | 'platform' {
  switch (type) {
    case 'CATALOG':
      return 'catalog';
    case 'REVIEW':
      return 'review';
    case 'CURATION':
      return 'curation';
    case 'PLATFORM':
      return 'platform';
    case 'SELLER':
    default:
      return 'seller';
  }
}

// Helper function to get badge variant from personality type
export function getPersonalityBadgeVariant(
  personality: string
): 'conservative' | 'balanced' | 'aggressive' | 'opportunistic' {
  switch (personality) {
    case 'conservative':
      return 'conservative';
    case 'aggressive':
      return 'aggressive';
    case 'opportunistic':
      return 'opportunistic';
    case 'balanced':
    default:
      return 'balanced';
  }
}
