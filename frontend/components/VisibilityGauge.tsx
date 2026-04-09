'use client';

interface VisibilityGaugeProps {
  score: number | null;
  size?: 'sm' | 'md' | 'lg';
}

function getScoreColor(score: number): string {
  if (score >= 75) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  if (score >= 25) return 'var(--color-claude)';
  return 'var(--danger)';
}

function getScoreLabel(score: number): string {
  if (score >= 75) return 'Excellent';
  if (score >= 50) return 'Good';
  if (score >= 25) return 'Fair';
  return 'Low';
}

export default function VisibilityGauge({ score, size = 'md' }: VisibilityGaugeProps) {
  const displayScore = score ?? 0;
  const color = score !== null ? getScoreColor(displayScore) : 'var(--text-faint)';
  const label = score !== null ? getScoreLabel(displayScore) : 'No data';

  const sizeMap = {
    sm: { svg: 160, cx: 80, cy: 80, r: 60, strokeWidth: 10, fontSize: 28, labelSize: 11 },
    md: { svg: 220, cx: 110, cy: 110, r: 85, strokeWidth: 12, fontSize: 40, labelSize: 13 },
    lg: { svg: 280, cx: 140, cy: 140, r: 110, strokeWidth: 14, fontSize: 52, labelSize: 15 },
  };

  const dims = sizeMap[size];
  const circumference = 2 * Math.PI * dims.r;
  const arcLength = circumference * 0.75;
  const filledLength = (displayScore / 100) * arcLength;
  const rotation = 135;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: dims.svg, height: dims.svg }}>
        <svg
          width={dims.svg}
          height={dims.svg}
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          {/* Background track */}
          <circle
            cx={dims.cx}
            cy={dims.cy}
            r={dims.r}
            fill="none"
            stroke="rgba(167,139,250,0.18)"
            strokeWidth={dims.strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
          />
          {/* Filled arc */}
          <circle
            cx={dims.cx}
            cy={dims.cy}
            r={dims.r}
            fill="none"
            stroke={color}
            strokeWidth={dims.strokeWidth}
            strokeDasharray={`${filledLength} ${circumference}`}
            strokeLinecap="round"
            style={{
              transition: 'stroke-dasharray 0.6s ease',
            }}
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold leading-none font-mono"
            style={{ fontSize: dims.fontSize, color: score !== null ? color : 'var(--text-faint)' }}
          >
            {score !== null ? `${Math.round(displayScore)}` : '--'}
          </span>
          <span
            className="text-[var(--text-muted)] mt-1 font-medium"
            style={{ fontSize: dims.labelSize }}
          >
            {score !== null ? '%' : ''}
          </span>
        </div>
      </div>

      <div className="text-center -mt-2">
        <p className="text-sm font-semibold text-[var(--text-secondary)]">Visibility Score</p>
        <p className="text-xs mt-0.5 font-medium" style={{ color }}>
          {label}
        </p>
      </div>
    </div>
  );
}
