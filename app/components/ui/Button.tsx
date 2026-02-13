import { ReactNode, ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-cyber-600 text-void font-medium hover:bg-cyber-500 disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-wider',
  secondary:
    'bg-transparent border border-neutral-600 text-neutral-300 font-medium hover:border-neutral-500 hover:text-neutral-200 uppercase tracking-wider',
  ghost:
    'bg-transparent text-neutral-400 font-medium hover:bg-neutral-800 hover:text-neutral-200 uppercase tracking-wider',
  danger:
    'bg-neutral-900 text-red-500 border border-red-900/50 font-medium hover:bg-red-900/30 uppercase tracking-wider',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs rounded',
  md: 'px-4 py-2 text-xs rounded',
  lg: 'px-5 py-2.5 text-sm rounded',
};

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  loading = false,
  fullWidth = false,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${fullWidth ? 'w-full' : ''}
        transition-all duration-200
        inline-flex items-center justify-center gap-2
        ${className}
      `}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="animate-blink">▋</span>}
      {children}
    </button>
  );
}
