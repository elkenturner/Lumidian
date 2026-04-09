'use client';

import { format, parseISO } from 'date-fns';
import { Edit2, CheckCircle2, Send, Trash2, BarChart2 } from 'lucide-react';
import { ContentDraft } from '@/lib/api';
import PlatformBadge from './PlatformBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ContentDraftCardProps {
  draft: ContentDraft;
  onEdit: (draft: ContentDraft) => void;
  onApprove: (id: number) => void;
  onPost: (id: number) => void;
  onDelete: (id: number) => void;
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline';

const STATUS_BADGE_VARIANTS: Record<string, BadgeVariant> = {
  draft: 'secondary',
  approved: 'success',
  posted: 'default',
  failed: 'destructive',
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
  const badgeVariant = STATUS_BADGE_VARIANTS[draft.status] ?? 'secondary';
  const statusLabel = STATUS_LABELS[draft.status] ?? draft.status;

  const preview = draft.title
    ? null
    : draft.content_text.length > 120
    ? draft.content_text.slice(0, 120) + '…'
    : draft.content_text;

  return (
    <div className="bg-[rgba(167,139,250,0.08)] border border-[rgba(167,139,250,0.20)] rounded-xl p-5 flex flex-col gap-3 hover:border-[rgba(167,139,250,0.35)] hover:bg-[rgba(167,139,250,0.11)] transition-[border-color,background-color] duration-200 shadow-[0_4px_24px_rgba(0,0,0,0.30),inset_0_1px_0_rgba(255,255,255,0.055)]">
      {/* Top row: platform + status */}
      <div className="flex items-center gap-2 flex-wrap">
        <PlatformBadge platform={draft.platform} />
        <Badge variant={badgeVariant}>{statusLabel}</Badge>
      </div>

      {/* Title or preview */}
      <div>
        {draft.title ? (
          <p className="text-sm font-semibold text-[var(--text-primary)] leading-snug">{draft.title}</p>
        ) : (
          <p className="text-sm italic text-[var(--text-muted)] leading-snug">{preview}</p>
        )}
      </div>

      {/* Target prompt */}
      {draft.prompt_text && (
        <p className="text-xs text-[var(--text-faint)]">
          <span className="text-[var(--text-muted)]">Targeting: </span>
          {draft.prompt_text}
        </p>
      )}

      {/* Meta row */}
      <div className="flex items-center gap-4 text-xs text-[var(--text-faint)]">
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
        <Button
          size="sm"
          variant="outline"
          onClick={() => onEdit(draft)}
        >
          <Edit2 size={12} />
          Edit
        </Button>

        {draft.status === 'draft' && (
          <Button
            size="sm"
            variant="success"
            onClick={() => onApprove(draft.id)}
          >
            <CheckCircle2 size={12} />
            Approve
          </Button>
        )}

        {draft.status === 'approved' && (
          <Button
            size="sm"
            variant="default"
            onClick={() => onPost(draft.id)}
          >
            <Send size={12} />
            Post
          </Button>
        )}

        <Button
          size="sm"
          variant="destructive"
          className="ml-auto"
          onClick={() => onDelete(draft.id)}
        >
          <Trash2 size={12} />
          Delete
        </Button>
      </div>
    </div>
  );
}
