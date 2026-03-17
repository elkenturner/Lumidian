'use client';

import { useState } from 'react';
import { TrendingUp, TrendingDown, ExternalLink } from 'lucide-react';
import { ContentAttribution } from '@/lib/api';
import { format, parseISO } from 'date-fns';

interface AttributionBadgeProps {
  attribution: ContentAttribution;
}

export default function AttributionBadge({ attribution }: AttributionBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  const pct = attribution.improvement_pct;
  const isPositive = pct != null && pct >= 0;
  const platform = attribution.platform ?? 'content';

  return (
    <div className="inline-block">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border transition-colors ${
          isPositive
            ? 'bg-green-900/30 text-green-400 border-green-800 hover:bg-green-900/50'
            : 'bg-red-900/30 text-red-400 border-red-800 hover:bg-red-900/50'
        }`}
      >
        {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
        {pct != null
          ? `${isPositive ? '+' : ''}${pct.toFixed(1)}% from ${platform} post`
          : `${platform} post`}
      </button>

      {expanded && (
        <div className="absolute z-10 mt-1 w-64 bg-[#111118] border border-[#1e1e2e] rounded-xl p-4 shadow-xl space-y-2">
          <div className="flex justify-between text-xs text-[#64748b]">
            {attribution.visibility_before != null && (
              <span>
                Before:{' '}
                <span className="text-[#94a3b8] font-medium">
                  {attribution.visibility_before.toFixed(1)}%
                </span>
              </span>
            )}
            {attribution.visibility_after != null && (
              <span>
                After:{' '}
                <span className="text-[#94a3b8] font-medium">
                  {attribution.visibility_after.toFixed(1)}%
                </span>
              </span>
            )}
          </div>
          <p className="text-xs text-[#64748b]">
            Measured {format(parseISO(attribution.measured_at), 'MMM d, h:mm a')}
          </p>
          {attribution.post_url && (
            <a
              href={attribution.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[#6366f1] hover:text-[#818cf8]"
            >
              <ExternalLink size={11} />
              View post
            </a>
          )}
        </div>
      )}
    </div>
  );
}
