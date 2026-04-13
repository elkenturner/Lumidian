# Manual-Only Opportunity Scanning

**Date:** 2026-04-12
**Status:** Approved

## Summary

Remove all scheduled (auto) opportunity scans and make scanning fully manual/on-demand for all users. Free users gain access to manual scanning (previously blocked), with a 2 scans/week limit.

## Current State

- 4 scheduled Monday cron jobs auto-scan Reddit (03:15), Quora (03:30), LinkedIn (03:40), X (03:50)
- Free users receive auto-weekly scans but cannot trigger manual scans (402 blocked)
- Starter: auto-weekly + 10 manual scans/week
- Pro: auto-weekly + 25 manual scans/week (all 4 platforms)
- Onboarding triggers a scan on brand creation

## Changes

### 1. Remove Scheduled Scanner Jobs

Remove from `scheduler.py`:
- `_reddit_scanner_sweep()` function and its Monday 03:15 cron trigger
- `_quora_scanner_sweep()` function and its Monday 03:30 cron trigger
- `_linkedin_scanner_sweep()` function and its Monday 03:40 cron trigger
- `_x_scanner_sweep()` function and its Monday 03:50 cron trigger

### 2. Update Manual Scan Limits

In `routers/opportunities.py`, update `WEEKLY_SCAN_LIMITS`:

| Tier | Before | After |
|------|--------|-------|
| Free (None/"") | 0 (blocked with 402) | 2 |
| Starter | 10 | 10 (unchanged) |
| Pro | 25 | 25 (unchanged) |
| Pitch | 1 | 1 (unchanged) |

Remove the free-tier block that returns 402 before checking limits.

### 3. Keep Brand Creation Scan

The scan triggered during onboarding/brand creation remains untouched. This is not part of the scheduler — it's triggered inline during the brand setup flow.

## What Does NOT Change

- Platform gating: LinkedIn + X remain Pro-only
- 90-day opportunity display window
- Draft-from-opportunity flow and tier checks
- Dismiss/view behavior
- Opportunity scoring, filtering, and cap logic in scanner services
- Pitch brand restrictions (can't draft, 1 scan/week)
- Rate limiting (3 scans/minute burst guard)
- Concurrent scan prevention

## Files Affected

- `backend/app/scheduler.py` — remove 4 sweep functions + 4 cron job registrations
- `backend/app/routers/opportunities.py` — update `WEEKLY_SCAN_LIMITS`, remove free-tier 402 block
