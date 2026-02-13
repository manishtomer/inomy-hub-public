'use client';

import { Button } from '@/components/ui/Button';

interface InvestButtonProps {
  onClick: () => void;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function InvestButton({ onClick, disabled, size = 'sm' }: InvestButtonProps) {
  return (
    <Button
      variant="primary"
      size={size}
      onClick={onClick}
      disabled={disabled}
    >
      Invest
    </Button>
  );
}
