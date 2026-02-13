'use client';

interface AgentAvatarProps {
  name: string;
  size?: number;
  className?: string;
}

export function AgentAvatar({ name, size = 28, className = '' }: AgentAvatarProps) {
  const src = `https://api.dicebear.com/9.x/bottts/svg?seed=${encodeURIComponent(name)}`;

  return (
    <img
      src={src}
      alt={name}
      width={size}
      height={size}
      className={`flex-shrink-0 rounded-full ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
