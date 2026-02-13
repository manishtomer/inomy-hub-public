interface LiveIndicatorProps {
  label?: string;
  className?: string;
}

export function LiveIndicator({ label = 'Live', className = '' }: LiveIndicatorProps) {
  return (
    <div className={`flex items-center gap-1.5 text-emerald-500 text-xs uppercase tracking-wider ${className}`}>
      <span className="live-indicator" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
