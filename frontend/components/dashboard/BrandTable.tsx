'use client';

import { useState } from 'react';
import {
  ChevronDown,
  MessageSquare,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DashboardAnalytics } from '@/lib/api';
import { MODEL_CONFIG } from './helpers';
import ResponseText from '@/components/ui/ResponseText';

interface BrandTableProps {
  analytics: DashboardAnalytics | null;
  loadingAnalytics: boolean;
  isRunning: boolean;
  isMobile: boolean;
  expandedConvId: number | null;
  setExpandedConvId: (id: number | null) => void;
  convModelFilter: string;
  setConvModelFilter: (filter: string) => void;
}

export default function BrandTable({
  analytics,
  loadingAnalytics,
  isRunning,
  isMobile,
  expandedConvId,
  setExpandedConvId,
  convModelFilter,
  setConvModelFilter,
}: BrandTableProps) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--accent-border)] flex items-center justify-between bg-[var(--accent-muted)]">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-[var(--accent)]" />
          <h3 className="text-[15px] font-medium text-[var(--text-primary)]">Recent Conversations</h3>
          {analytics && (
            <span className="text-xs text-[var(--text-muted)] bg-[var(--bg-tinted)] border border-[var(--bg-tinted-hover)] px-2 py-0.5 rounded-full">
              {analytics.total_responses_analyzed.toLocaleString()} analyzed
            </span>
          )}
        </div>
        {/* Model filter tabs */}
        {analytics && analytics.recent_conversations.length > 0 && (() => {
          const models = Array.from(new Set(analytics.recent_conversations.map((c) => {
            const key = c.model.toLowerCase().replace(/[-_\s]/g, '');
            return Object.keys(MODEL_CONFIG).find((k) => key.includes(k)) ?? c.model;
          })));
          if (models.length < 2) return null;
          return (
            <div className="flex items-center gap-1 bg-[rgba(255,255,255,0.04)] border border-[var(--accent-border)] rounded-lg p-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
              <button
                onClick={() => setConvModelFilter('all')}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color] ${convModelFilter === 'all' ? 'bg-[var(--accent-muted)] text-[var(--accent-light)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
              >
                All
              </button>
              {models.map((mk) => {
                const cfg = MODEL_CONFIG[mk] ?? { label: mk, text: 'var(--text-secondary)' };
                return (
                  <button
                    key={mk}
                    onClick={() => setConvModelFilter(convModelFilter === mk ? 'all' : mk)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[color,background-color] ${convModelFilter === mk ? 'bg-[var(--accent-muted)]' : 'text-[var(--text-faint)] hover:text-[var(--text-secondary)]'}`}
                    style={convModelFilter === mk ? { color: cfg.text } : {}}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          );
        })()}
      </div>

      {loadingAnalytics || isRunning ? (
        <div className="divide-y divide-[var(--accent-muted)]">
          {[1,2,3,4].map(i => (
            <div key={i} className="px-5 py-4 animate-pulse">
              <div className="flex items-center justify-between mb-2">
                <div className="h-3.5 bg-[var(--bg-tinted)] rounded w-2/5" />
                <div className="flex gap-2">
                  <div className="w-16 h-5 bg-[var(--bg-tinted)] rounded" />
                  <div className="w-20 h-5 bg-[var(--bg-tinted)] rounded" />
                </div>
              </div>
              <div className="h-3 bg-[var(--bg-tinted)] rounded w-4/5" />
            </div>
          ))}
        </div>
      ) : analytics && analytics.recent_conversations.length > 0 ? (
        <div className="divide-y divide-[var(--accent-muted)]">
          {analytics.recent_conversations.filter((conv) => {
            if (convModelFilter === 'all') return true;
            const key = conv.model.toLowerCase().replace(/[-_\s]/g, '');
            return key.includes(convModelFilter);
          }).sort((a, b) => (b.mentioned ? 1 : 0) - (a.mentioned ? 1 : 0))
          .map((conv) => {
            const modelKey = conv.model.toLowerCase().replace(/[-_\s]/g, '');
            const mc = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))?.[1]
              ?? { bg: 'var(--bg-card)', text: 'var(--text-secondary)' };
            const label = Object.entries(MODEL_CONFIG).find(([k]) => modelKey.includes(k))
              ? MODEL_CONFIG[Object.keys(MODEL_CONFIG).find(k => modelKey.includes(k))!].label
              : conv.model;

            return (
              <div key={conv.id} className="stagger-row">
                <button
                  className="w-full px-5 py-4 hover:bg-[var(--accent-muted)] transition-colors text-left"
                  onClick={() => setExpandedConvId(expandedConvId === conv.id ? null : conv.id)}
                >
                  <div className="flex items-start justify-between gap-3 mb-1.5">
                    <span className="text-xs font-medium text-[var(--text-secondary)] leading-relaxed flex-1 min-w-0">
                      {conv.prompt_text.length > 80 ? conv.prompt_text.slice(0, 80) + '\u2026' : conv.prompt_text}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <Badge style={{ backgroundColor: mc.bg, color: mc.text, borderColor: 'transparent' }}>
                        {label}
                      </Badge>
                      {!isMobile && (
                        <Badge variant={conv.mentioned ? "success" : "secondary"}>
                          {conv.mentioned ? 'Mentioned' : 'Not mentioned'}
                        </Badge>
                      )}
                      <ChevronDown
                        size={12}
                        className={`text-[var(--text-faint)] transition-transform ${expandedConvId === conv.id ? 'rotate-180' : ''}`}
                      />
                    </div>
                  </div>
                  {conv.response_preview && (
                    <div className="line-clamp-2">
                      <ResponseText
                        text={conv.response_preview}
                        brandName={analytics?.brand_name ?? ''}
                        competitors={analytics?.competitor_comparison.map((c) => c.name) ?? []}
                        maxLength={120}
                        className="text-xs text-[var(--text-faint)]"
                      />
                    </div>
                  )}
                </button>
                {expandedConvId === conv.id && conv.response_text && (
                  <div className="px-5 pb-4 pt-3 border-t border-[var(--accent-border)] bg-[var(--accent-muted)]">
                    <ResponseText
                      text={conv.response_text}
                      brandName={analytics?.brand_name ?? ''}
                      competitors={analytics?.competitor_comparison.map((c) => c.name) ?? []}
                      className="text-xs sm:text-sm text-[var(--text-muted)]"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{
              background: 'linear-gradient(135deg, var(--accent-muted), var(--accent-muted))',
              border: '1px solid var(--accent-border)',
              boxShadow: '0 0 28px var(--accent-muted)',
            }}
          >
            <MessageSquare size={24} className="text-[var(--accent-light)]" />
          </div>
          <p className="text-base font-semibold text-[var(--text-primary)] mb-1.5">No conversations yet</p>
          <p className="text-[13px] text-[var(--text-muted)] max-w-xs leading-relaxed">Run a report to start tracking how AI models respond to your prompts.</p>
        </div>
      )}
    </div>
  );
}
