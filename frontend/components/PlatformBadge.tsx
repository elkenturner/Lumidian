'use client';

interface PlatformBadgeProps {
  platform: string;
  size?: 'sm' | 'md';
}

const PLATFORM_STYLES: Record<string, string> = {
  reddit: 'bg-orange-900/30 text-orange-400 border-orange-800',
  quora: 'bg-red-900/30 text-red-400 border-red-800',
  medium: 'bg-gray-800 text-gray-300 border-gray-700',
  wikipedia: 'bg-teal-900/30 text-teal-400 border-teal-800',
};

const PLATFORM_LABELS: Record<string, string> = {
  reddit: 'Reddit',
  quora: 'Quora',
  medium: 'Medium',
  wikipedia: 'Wikipedia',
};

export default function PlatformBadge({ platform, size = 'md' }: PlatformBadgeProps) {
  const key = platform.toLowerCase();
  const styles = PLATFORM_STYLES[key] ?? 'bg-[#1a1a24] text-[#94a3b8] border-[#2a2a3a]';
  const label = PLATFORM_LABELS[key] ?? platform;

  const sizeClasses = size === 'sm'
    ? 'text-xs px-1.5 py-0.5'
    : 'text-xs px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center font-semibold border rounded-full capitalize ${sizeClasses} ${styles}`}
    >
      {label}
    </span>
  );
}
