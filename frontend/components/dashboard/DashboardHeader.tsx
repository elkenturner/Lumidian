'use client';

import Link from 'next/link';
import {
  Plus,
  Zap,
  MessageSquare,
  Play,
  Loader2,
  RefreshCw,
  PauseCircle,
  XCircle,
} from 'lucide-react';
import BrandAvatar from '@/components/BrandAvatar';

interface BrandSummary {
  id: number;
  name: string;
  website_url?: string | null;
}

interface DashboardHeaderProps {
  selectedBrand: BrandSummary | undefined;
  selectedBrandId: number | null;
  isMobile: boolean;
  triggering: boolean;
  isRunning: boolean;
  isAtRunLimit: boolean;
  isSubscriptionPaused?: boolean;
  onOpenPromptModal: () => void;
  onRefresh: () => void;
  onRunReport: () => void;
  onUpgradeClick: () => void;
  onCancelRun?: () => void;
}

export default function DashboardHeader({
  selectedBrand,
  selectedBrandId,
  isMobile,
  triggering,
  isRunning,
  isAtRunLimit,
  isSubscriptionPaused,
  onOpenPromptModal,
  onRefresh,
  onRunReport,
  onUpgradeClick,
  onCancelRun,
}: DashboardHeaderProps) {
  const isDisabled = triggering || isRunning || !selectedBrandId || isSubscriptionPaused;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div className="flex items-center gap-3">
        {selectedBrand && (
          <BrandAvatar
            name={selectedBrand.name}
            websiteUrl={selectedBrand.website_url ?? undefined}
            size={36}
            className="rounded-xl bg-[var(--accent-muted)] border border-[var(--accent-border)]"
            style={{ padding: 5 }}
            textClassName="text-sm font-bold text-[var(--accent)]"
          />
        )}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]" style={{ fontFamily: 'var(--font-syne)', fontWeight: 800, letterSpacing: '-0.3px' }}>
            {selectedBrand ? selectedBrand.name : 'Dashboard'}
          </h1>
          <p className="text-[13px] text-[var(--text-muted)] mt-1.5">AI visibility analytics</p>
        </div>
      </div>
      <div className={`flex ${isMobile ? 'flex-col w-full' : 'items-center'} gap-2 sm:gap-3`}>
        <div className={`flex ${isMobile ? 'w-full' : ''} items-center gap-2`}>
        <button
          onClick={onOpenPromptModal}
          disabled={!selectedBrandId}
          className={`flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[rgba(255,255,255,0.14)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 text-xs transition-[color,border-color] duration-150 ${isMobile ? 'flex-1 justify-center min-h-[44px]' : ''}`}
        >
          <MessageSquare size={14} />
          Prompts
        </button>
        <button
          onClick={onRefresh}
          aria-label="Refresh dashboard"
          className={`flex items-center gap-2 bg-[var(--accent-muted)] hover:bg-[var(--accent-muted)] border border-[var(--accent-border)] hover:border-[rgba(255,255,255,0.14)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] rounded-lg px-3 py-2 transition-[color,border-color] duration-150 ${isMobile ? 'min-h-[44px]' : ''}`}
        >
          <RefreshCw size={14} />
        </button>
        </div>
        <div className={`flex flex-col ${isMobile ? 'w-full' : 'items-end'} gap-1`}>
          {isSubscriptionPaused ? (
            <Link
              href="/settings/billing"
              className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold bg-[#7f1d1d]/20 border border-[#991b1b]/40 text-[var(--danger-text)] hover:bg-[#7f1d1d]/30 transition-colors ${isMobile ? 'w-full justify-center' : ''}`}
            >
              <PauseCircle size={14} />
              Tracking Paused
            </Link>
          ) : (
            <button
              onClick={isAtRunLimit ? onUpgradeClick : onRunReport}
              disabled={isDisabled}
              title={isAtRunLimit ? 'Daily run limit reached — resets at midnight UTC' : undefined}
              className={`flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-[background-color,box-shadow] duration-200 ${isMobile ? 'w-full justify-center' : ''} ${
                isAtRunLimit
                  ? 'bg-[var(--accent-muted)] border border-[var(--accent-border)] text-[var(--text-faint)] cursor-default'
                  : 'bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-white shadow-lg shadow-[var(--accent)]/25 hover:shadow-[var(--accent)]/40 hover:shadow-xl'
              }`}
            >
              {triggering || isRunning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {isRunning ? 'Running...' : 'Starting...'}
                  {isRunning && onCancelRun && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancelRun(); }}
                      title="Cancel run"
                      className="ml-1 p-0.5 rounded hover:bg-white/20 transition-colors"
                    >
                      <XCircle size={14} />
                    </button>
                  )}
                </>
              ) : isAtRunLimit ? (
                <>
                  <Zap size={14} className="text-[var(--accent)]/60" />
                  1 run / day
                </>
              ) : (
                <>
                  <Play size={14} />
                  Run Report Now
                </>
              )}
            </button>
          )}
          {isSubscriptionPaused ? (
            <p className="text-[11px] text-[var(--danger)]/70">
              Your subscription has ended.{' '}
              <Link
                href="/settings/billing"
                className="text-[var(--danger-text)] hover:underline"
              >
                Upgrade to continue
              </Link>
            </p>
          ) : isAtRunLimit ? (
            <p className="text-[11px] text-[var(--text-faint)]">
              Resets midnight UTC ·{' '}
              <button
                onClick={onUpgradeClick}
                className="text-[var(--accent)] hover:text-[var(--accent-light)] transition-colors"
              >
                Upgrade
              </button>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
