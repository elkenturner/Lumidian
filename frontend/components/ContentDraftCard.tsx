'use client';

import { format, parseISO } from 'date-fns';
import { Edit2, CheckCircle2, Send, Trash2, BarChart2 } from 'lucide-react';
import { ContentDraft } from '@/lib/api';
import PlatformBadge from './PlatformBadge';

interface ContentDraftCardProps {
  draft: ContentDraft;
  onEdit: (draft: ContentDraft) => void;
  onApprove: (id: number) => void;
  onPost: (id: number) => void;
  onDelete: (id: number) => void;
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-[#1e1e2e] text-[#94a3b8] border-[#2a2a3a]',
  approved: 'bg-[#064e3b]/30 text-[#10b981] border-[#065f46]/40',
  posted: 'bg-[#172554]/40 text-[#60a5fa] border-[#1d4ed8]/30',
  failed: 'bg-[#7f1d1d]/20 text-[#f87171] border-[#991b1b]/30',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  approved: 'Approved',
  posted: 'Posted',
  failed: 'Failed',
};

export default function ContentDraftCard({
  draft,
  onEdit,
  onApprove,
  onPost,
  onDelete,
}: ContentDraftCardProps) {
  const statusStyle = STATUS_STYLES[draft.status] ?? STATUS_STYLES.draft;
  const statusLabel = STATUS_LABELS[draft.status] ?? draft.status;

  const preview = draft.title
    ? null
    : draft.content_text.length > 120
    ? draft.content_text.slice(0, 120) + '…'
    : draft.content_text;

  return (
    <div className="bg-[#111118] border border-[#1e1e2e] rounded-xl p-5 flex flex-col gap-3 hover:border-[#2a2a3a] transition-colors">
      {/* Top row: platform + status */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        <span
          className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full border ${statusStyle}`}
        >
          {statusLabel}
        </span>
      </div>

      {/* Title or preview */}
      <div>
        {draft.title ? (
          <p className="text-sm font-semibold text-[#e2e8f0] leading-snug">{draft.title}</p>
        ) : (
          <p className="text-sm italic text-[#64748b] leading-snug">{preview}</p>
        )}
      </div>

      {/* Target prompt */}
      {draft.prompt_text && (
        <p className="text-xs text-[#475569]">
          <span className="text-[#64748b]">Targeting: </span>
          {draft.prompt_text}
        </p>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-[#475569]">
        {draft.visibility_score_at_draft != null && (
          <span className="flex items-center gap-1">
            <BarChart2 size={11} />
            {Math.round(draft.visibility_score_at_draft)}% at draft
          </span>
        )}
        <span>{format(parseISO(draft.created_at), 'MMM d, yyyy')}</span>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button
          onClick={() => onEdit(draft)}
          className="flex items-center gap-1.5 text-xs bg-[#1a1a24] hover:bg-[#2a2a3a] border border-[#2a2a3a] text-[#94a3b8] hover:text-[#e2e8f0] rounded-lg px-3 py-1.5 transition-colors"
        >
          <Edit2 size={12} />
          Edit
        </button>

        {draft.status === 'draft' && (
          <button
            onClick={() => onApprove(draft.id)}
            className="flex items-center gap-1.5 text-xs bg-[#064e3b]/30 hover:bg-[#064e3b]/50 border border-[#065f46]/40 text-[#10b981] rounded-lg px-3 py-1.5 transition-colors"
          >
            <CheckCircle2 size={12} />
            Approve
          </button>
        )}

        {draft.status === 'approved' && (
          <button
            onClick={() => onPost(draft.id)}
            className="flex items-center gap-1.5 text-xs bg-[#6366f1] hover:bg-[#4f46e5] text-white rounded-lg px-3 py-1.5 transition-colors"
          >
            <Send size={12} />
            Post
          </button>
        )}

        <button
          onClick={() => onDelete(draft.id)}
          className="flex items-center gap-1.5 text-xs bg-[#7f1d1d]/20 hover:bg-[#7f1d1d]/30 border border-[#991b1b]/30 text-[#f87171] rounded-lg px-3 py-1.5 transition-colors ml-auto"
        >
          <Trash2 size={12} />
          Delete
        </button>
      </div>
    </div>
  );
}
