import { parseISO } from 'date-fns';

export function parseUTCISO(dateString: string): Date {
  return parseISO(dateString.endsWith('Z') ? dateString : dateString + 'Z');
}

export function formatScore(score: number | null | undefined): string {
  if (score == null) return '—';
  return `${Math.round(score)}%`;
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '\u2026';
}
