'use client';

import { motion } from 'framer-motion';
import { useCountUp } from '@/lib/motion';
import { scoreToGrade, gradeColor, gradeLabel } from '@/lib/grade';
import HelpTooltip from '@/components/dashboard/HelpTooltip';

interface Props {
  label: string;
  score: number | null;
  explanation: string;
  emphasis?: boolean;
}

export function ScoreCard({ label, score, explanation, emphasis = false }: Props) {
  const grade = scoreToGrade(score);
  const color = gradeColor(grade);
  const animated = useCountUp(score ?? 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      className={`${emphasis ? 'card-elevated' : 'card card-hover'} flex flex-col items-center justify-center text-center`}
      style={{ minHeight: emphasis ? 168 : 132 }}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
        {label}
        <HelpTooltip text={explanation} />
      </p>
      <p
        className={`font-bold tabular-nums leading-none mt-2 ${
          emphasis ? 'text-6xl' : 'text-3xl'
        }`}
        style={{ color }}
      >
        {grade}
      </p>
      <p className="text-[11px] text-[var(--text-faint)] mt-2 tabular-nums">
        {score != null ? animated : '—'}
        <span className="text-[var(--text-faint)]">/100</span>
      </p>
      {emphasis && (
        <p className="text-xs mt-1" style={{ color }}>
          {gradeLabel(grade)}
        </p>
      )}
    </motion.div>
  );
}
