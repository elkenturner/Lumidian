'use client';

import { Lightbulb } from 'lucide-react';
import Link from 'next/link';
import { Callout } from '@/components/ui/callout';

interface MethodologyCalloutProps {
  visible: boolean;
}

export default function MethodologyCallout({ visible }: MethodologyCalloutProps) {
  if (!visible) return null;
  return (
    <Callout
      storageKey="lumidian_methodology_dismissed"
      dismissible
      icon={<Lightbulb size={14} />}
      title="Understanding Your Visibility Score"
      body={
        <>
          Your visibility score is calculated by sending your prompts to{' '}
          <span className="text-[var(--text-secondary)] font-medium">4 AI assistants</span>{' '}
          — ChatGPT, Claude, Perplexity, and Gemini — each with live web search enabled, and measuring how often your brand is mentioned in the responses.
        </>
      }
      action={
        <Link
          href="/methodology"
          className="inline-block text-xs text-[var(--accent-light)] hover:text-[var(--text-primary)] font-medium transition-colors"
        >
          Learn more &rsaquo;
        </Link>
      }
    />
  );
}
