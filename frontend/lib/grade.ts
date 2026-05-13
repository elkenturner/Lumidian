// Score → letter grade band mapping, keyed to existing theme color tokens.
// Used across the Site Audit redesign to give 0-100 scores a meaning the
// numbers alone don't carry.

export type GradeBand = 'A' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D' | 'F';

export function scoreToGrade(score: number | null | undefined): GradeBand | '—' {
  if (score == null || Number.isNaN(score)) return '—';
  if (score >= 90) return 'A';
  if (score >= 85) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 75) return 'B-';
  if (score >= 70) return 'C+';
  if (score >= 65) return 'C';
  if (score >= 60) return 'C-';
  if (score >= 50) return 'D';
  return 'F';
}

export function gradeColor(g: GradeBand | '—'): string {
  switch (g) {
    case 'A':
    case 'B+':
      return 'var(--success)';
    case 'B':
    case 'B-':
      return 'var(--success-text)';
    case 'C+':
    case 'C':
      return 'var(--warning-text)';
    case 'C-':
      return 'var(--warning)';
    case 'D':
      return 'var(--danger-text)';
    case 'F':
      return 'var(--danger)';
    default:
      return 'var(--text-muted)';
  }
}

export function gradeLabel(g: GradeBand | '—'): string {
  switch (g) {
    case 'A':
      return 'Excellent';
    case 'B+':
    case 'B':
      return 'Good';
    case 'B-':
    case 'C+':
      return 'Decent';
    case 'C':
    case 'C-':
      return 'Needs work';
    case 'D':
      return 'Poor';
    case 'F':
      return 'Critical';
    default:
      return '—';
  }
}
