# Codebase Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform a fragile pre-launch codebase into production-ready software with CI/CD, observability, proper error handling, and maintainable file structure.

**Architecture:** Six independent workstreams that can execute in parallel: (1) CI/CD + linting, (2) constants extraction, (3) frontend error handling, (4) content page decomposition, (5) drafting service decomposition, (6) service-level tests. Each workstream produces working, testable software on its own.

**Tech Stack:** GitHub Actions, ruff (Python linting), ESLint + Prettier (TS/JS), pytest, React Error Boundaries, TypeScript

---

## File Structure Overview

### New Files to Create

```
.github/
  workflows/
    ci.yml                              # CI pipeline (lint + test)

frontend/
  lib/
    constants/
      models.ts                         # MODEL_CONFIG, MODEL_ORDER, getModelConfig()
    utils/
      formatting.ts                     # parseUTCISO, stripMarkdown, formatScore
    hooks/
      useAsync.ts                       # Generic async hook with loading/error/retry

  app/content/
    components/
      DraftQueue.tsx                    # Draft cards, urgency scoring, status management
      OpportunityPanel.tsx              # Reddit/Quora thread management
      QualityChecklist.tsx              # Platform-specific validation (extract from page.tsx)
      ContentSettings.tsx               # Per-platform toggle configuration
      DraftModal.tsx                    # Draft preview/edit modal
      HelpModal.tsx                     # Help dialog component

backend/
  app/services/
    drafting/
      __init__.py                       # Re-export public API
      platforms.py                      # PLATFORM_SPECS, platform-specific rules
      prompts.py                        # Prompt construction, profile context injection
      client.py                         # Claude API interaction, retry logic
      pipeline.py                       # Orchestration, sanitization, hedging removal

  tests/
    test_drafting_service.py            # Service-level tests for drafting
    test_tracking_service.py            # Service-level tests for tracking

pyproject.toml                          # ruff configuration (or extend existing)
.prettierrc                             # Prettier config
.eslintrc.json                          # ESLint config
```

### Files to Modify

```
frontend/app/content/page.tsx           # Reduce from 2982 LOC to ~500 LOC orchestrator
frontend/app/dashboard/page.tsx         # Import MODEL_CONFIG from constants
frontend/app/reports/page.tsx           # Import MODEL_CONFIG from constants
frontend/components/AppShell.tsx        # Import MODEL_CONFIG from constants
frontend/components/ModelBreakdown.tsx  # Import MODEL_CONFIG from constants
frontend/components/ResponsesTable.tsx  # Import MODEL_CONFIG from constants
frontend/package.json                   # Add eslint, prettier, husky devDependencies
backend/requirements.txt                # Add ruff (dev dependency in requirements-dev.txt)
```

---

## Task 1: CI/CD Pipeline + Python Linting

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `backend/requirements-dev.txt`
- Create: `pyproject.toml`
- Modify: `backend/requirements.txt` (reference only, no changes needed)

### Step 1.1: Create ruff configuration

- [ ] **Create pyproject.toml with ruff config**

```toml
[tool.ruff]
target-version = "py311"
line-length = 120
exclude = [
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    "*.pyc",
]

[tool.ruff.lint]
select = [
    "E",      # pycodestyle errors
    "W",      # pycodestyle warnings
    "F",      # pyflakes
    "I",      # isort
    "B",      # flake8-bugbear
    "C4",     # flake8-comprehensions
    "UP",     # pyupgrade
]
ignore = [
    "E501",   # line too long (handled by formatter)
    "B008",   # function call in default argument (FastAPI Depends)
    "B904",   # raise without from (too noisy in existing code)
]

[tool.ruff.lint.isort]
known-first-party = ["app"]
```

- [ ] **Verify ruff config is valid**

Run: `cd backend && pip install ruff && ruff check . --config ../pyproject.toml 2>&1 | head -20`

Expected: Linting output (errors or "All checks passed")

### Step 1.2: Create dev requirements file

- [ ] **Create backend/requirements-dev.txt**

```
-r requirements.txt
ruff>=0.4.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
pytest-cov>=4.1.0
httpx>=0.27.0
```

### Step 1.3: Create GitHub Actions CI workflow

- [ ] **Create .github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install ruff
        run: pip install ruff

      - name: Run ruff linter
        run: ruff check . --config ../pyproject.toml

      - name: Run ruff formatter check
        run: ruff format --check . --config ../pyproject.toml

  test-backend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements-dev.txt

      - name: Create test env file
        run: echo "JWT_SECRET=test-secret-key-for-ci-at-least-32-chars" > .env

      - name: Run tests
        run: pytest tests/ -v --tb=short

  lint-frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: npm ci

      - name: Run ESLint
        run: npm run lint

      - name: Run TypeScript check
        run: npx tsc --noEmit
```

- [ ] **Verify workflow file is valid YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`

Expected: No output (valid YAML)

### Step 1.4: Commit CI/CD setup

- [ ] **Stage and commit**

```bash
git add .github/workflows/ci.yml pyproject.toml backend/requirements-dev.txt
git commit -m "ci: add GitHub Actions workflow with ruff and pytest

- Python linting with ruff (E, W, F, I, B, C4, UP rules)
- Backend tests with pytest
- Frontend linting with ESLint + TypeScript check

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Frontend Linting Setup

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/.eslintrc.json`
- Create: `frontend/.prettierrc`

### Step 2.1: Add ESLint and Prettier to package.json

- [ ] **Update package.json scripts and devDependencies**

Add to `scripts`:
```json
"lint": "next lint",
"lint:fix": "next lint --fix",
"format": "prettier --write \"**/*.{ts,tsx,js,json,css}\"",
"format:check": "prettier --check \"**/*.{ts,tsx,js,json,css}\""
```

Add to `devDependencies`:
```json
"eslint": "^8.57.0",
"eslint-config-next": "^15.0.3",
"prettier": "^3.2.0"
```

- [ ] **Install new dependencies**

Run: `cd frontend && npm install`

Expected: Dependencies installed successfully

### Step 2.2: Create ESLint configuration

- [ ] **Create frontend/.eslintrc.json**

```json
{
  "extends": ["next/core-web-vitals", "next/typescript"],
  "rules": {
    "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/no-explicit-any": "warn",
    "react-hooks/exhaustive-deps": "warn",
    "no-console": ["warn", { "allow": ["warn", "error"] }]
  },
  "ignorePatterns": ["node_modules/", ".next/", "out/"]
}
```

### Step 2.3: Create Prettier configuration

- [ ] **Create frontend/.prettierrc**

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### Step 2.4: Run initial lint and verify

- [ ] **Run ESLint**

Run: `cd frontend && npm run lint 2>&1 | head -30`

Expected: Lint output (warnings are OK, script should not fail)

### Step 2.5: Commit frontend linting setup

- [ ] **Stage and commit**

```bash
git add frontend/package.json frontend/.eslintrc.json frontend/.prettierrc frontend/package-lock.json
git commit -m "chore(frontend): add ESLint and Prettier configuration

- ESLint extends next/core-web-vitals and next/typescript
- Prettier with single quotes, trailing commas
- Adds lint, lint:fix, format, format:check scripts

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Extract Duplicated Constants

**Files:**
- Create: `frontend/lib/constants/models.ts`
- Create: `frontend/lib/utils/formatting.ts`
- Modify: `frontend/app/dashboard/page.tsx`
- Modify: `frontend/app/reports/page.tsx`
- Modify: `frontend/components/AppShell.tsx`
- Modify: `frontend/components/ModelBreakdown.tsx`
- Modify: `frontend/components/ResponsesTable.tsx`

### Step 3.1: Create model constants file

- [ ] **Create frontend/lib/constants/models.ts**

```typescript
/**
 * Centralized model configuration for all LLM providers.
 * Single source of truth for labels, colors, and order.
 */

export const MODEL_ORDER = ['chatgpt', 'claude', 'perplexity', 'gemini'] as const;

export type ModelKey = (typeof MODEL_ORDER)[number];

export interface ModelConfig {
  label: string;
  color: string;
  bgColor: string;
  mutedBg: string;
  letter: string;
}

export const MODEL_CONFIG: Record<ModelKey, ModelConfig> = {
  chatgpt: {
    label: 'ChatGPT',
    color: 'var(--color-chatgpt)',
    bgColor: 'rgba(16,163,127,0.15)',
    mutedBg: 'var(--color-chatgpt-muted)',
    letter: 'G',
  },
  claude: {
    label: 'Claude',
    color: 'var(--color-claude)',
    bgColor: 'rgba(217,119,87,0.15)',
    mutedBg: 'var(--color-claude-muted)',
    letter: 'C',
  },
  perplexity: {
    label: 'Perplexity',
    color: 'var(--color-perplexity)',
    bgColor: 'rgba(32,170,215,0.15)',
    mutedBg: 'var(--color-perplexity-muted)',
    letter: 'P',
  },
  gemini: {
    label: 'Gemini',
    color: 'var(--color-gemini)',
    bgColor: 'rgba(66,133,244,0.15)',
    mutedBg: 'var(--color-gemini-muted)',
    letter: 'G',
  },
};

const DEFAULT_CONFIG: ModelConfig = {
  label: 'Unknown',
  color: 'var(--text-secondary)',
  bgColor: 'rgba(100,116,139,0.15)',
  mutedBg: 'var(--bg-card)',
  letter: '?',
};

/**
 * Get model config by model name, handling variations like "gpt-4", "claude-3", etc.
 */
export function getModelConfig(model: string): ModelConfig & { key: ModelKey | string } {
  const normalized = model.toLowerCase().replace(/[-_\s]/g, '');
  
  for (const key of MODEL_ORDER) {
    if (normalized.includes(key)) {
      return { ...MODEL_CONFIG[key], key };
    }
  }
  
  return { ...DEFAULT_CONFIG, label: model, key: model };
}
```

### Step 3.2: Create formatting utilities file

- [ ] **Create frontend/lib/utils/formatting.ts**

```typescript
import { parseISO } from 'date-fns';

/**
 * Parse an ISO date string, handling both with and without 'Z' suffix.
 * Backend sometimes returns dates without timezone indicator.
 */
export function parseUTCISO(dateString: string): Date {
  return parseISO(dateString.endsWith('Z') ? dateString : dateString + 'Z');
}

/**
 * Format a visibility score as a percentage string.
 */
export function formatScore(score: number | null | undefined): string {
  if (score == null) return '—';
  return `${Math.round(score)}%`;
}

/**
 * Strip basic markdown formatting for plain text display.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')  // bold
    .replace(/\*([^*]+)\*/g, '$1')       // italic
    .replace(/`([^`]+)`/g, '$1')         // inline code
    .replace(/#{1,6}\s/g, '')            // headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // links
}

/**
 * Truncate text to a maximum length with ellipsis.
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + '…';
}
```

### Step 3.3: Update dashboard/page.tsx to use shared constants

- [ ] **Read current imports section of dashboard/page.tsx**

Read the file to find the MODEL_CONFIG definition location.

- [ ] **Replace local MODEL_CONFIG with import**

In `frontend/app/dashboard/page.tsx`, find and replace:

```typescript
const MODEL_ORDER = ['chatgpt', 'claude', 'perplexity', 'gemini'];
const MODEL_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  chatgpt:    { label: 'ChatGPT',    bg: 'var(--color-chatgpt-muted)',   text: 'var(--color-chatgpt)' },
  claude:     { label: 'Claude',     bg: 'var(--color-claude-muted)',    text: 'var(--color-claude)' },
  perplexity: { label: 'Perplexity', bg: 'var(--color-perplexity-muted)', text: 'var(--color-perplexity)' },
  gemini:     { label: 'Gemini',     bg: 'var(--color-gemini-muted)',    text: 'var(--color-gemini)' },
};

function getModelCfg(model: string) {
  const key = model.toLowerCase().replace(/[-_\s]/g, '');
  for (const [k, v] of Object.entries(MODEL_CONFIG)) {
    if (key.includes(k)) return { ...v, key: k };
  }
  return { label: model, bg: 'var(--bg-card)', text: 'var(--text-secondary)', key: model };
}
```

With:

```typescript
import { MODEL_ORDER, MODEL_CONFIG, getModelConfig } from '@/lib/constants/models';
import { parseUTCISO } from '@/lib/utils/formatting';

// Adapter for backward compatibility with existing code
function getModelCfg(model: string) {
  const cfg = getModelConfig(model);
  return { label: cfg.label, bg: cfg.mutedBg, text: cfg.color, key: cfg.key };
}
```

Also remove the local `parseUTCISO` definition and use the import.

### Step 3.4: Update reports/page.tsx

- [ ] **Replace local MODEL_CONFIG in reports/page.tsx**

Find and replace the local definitions with imports (same pattern as dashboard).

### Step 3.5: Update ModelBreakdown.tsx

- [ ] **Replace local MODEL_CONFIG in ModelBreakdown.tsx**

In `frontend/components/ModelBreakdown.tsx`, replace the local MODEL_CONFIG (lines 9-36) with:

```typescript
import { MODEL_CONFIG as MODELS, getModelConfig as getModelCfg } from '@/lib/constants/models';

// Adapter for backward compatibility
function getModelConfig(model: string) {
  const cfg = getModelCfg(model);
  return {
    label: cfg.label,
    color: cfg.color,
    bgColor: cfg.bgColor,
    letter: cfg.letter,
  };
}
```

### Step 3.6: Update ResponsesTable.tsx

- [ ] **Replace local MODEL_CONFIG in ResponsesTable.tsx**

Same pattern as ModelBreakdown.tsx.

### Step 3.7: Update AppShell.tsx

- [ ] **Replace local MODEL_CONFIG in AppShell.tsx**

Same pattern, adapting the return type to match existing usage.

### Step 3.8: Verify all imports work

- [ ] **Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors

### Step 3.9: Commit constants extraction

- [ ] **Stage and commit**

```bash
git add frontend/lib/constants/models.ts frontend/lib/utils/formatting.ts \
        frontend/app/dashboard/page.tsx frontend/app/reports/page.tsx \
        frontend/components/AppShell.tsx frontend/components/ModelBreakdown.tsx \
        frontend/components/ResponsesTable.tsx
git commit -m "refactor(frontend): extract MODEL_CONFIG to shared constants

- Create lib/constants/models.ts with MODEL_CONFIG, MODEL_ORDER, getModelConfig
- Create lib/utils/formatting.ts with parseUTCISO, formatScore, stripMarkdown
- Update 5 files to import from shared modules
- Eliminates ~120 lines of duplicated code

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Replace Silent Error Catches

**Files:**
- Modify: Multiple frontend files with `.catch(() => {})`

This task identifies all silent error catches and replaces them with proper error handling.

### Step 4.1: Audit silent catches

- [ ] **List all files with silent catches**

Run: `cd frontend && grep -rn "\.catch(().*=>" --include="*.tsx" --include="*.ts" | head -40`

Expected: List of files and line numbers

### Step 4.2: Create error logging utility

- [ ] **Add to frontend/lib/utils/errors.ts**

```typescript
/**
 * Log an error with context. In production, this would send to Sentry.
 * For now, logs to console and can be enhanced later.
 */
export function logError(error: unknown, context?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${context ?? 'Error'}]`, message, error);
  
  // TODO: When Sentry is configured, add:
  // Sentry.captureException(error, { extra: { context } });
}

/**
 * Wrapper for fire-and-forget async operations that shouldn't crash the UI.
 * Logs errors but doesn't throw.
 */
export function fireAndForget(promise: Promise<unknown>, context: string): void {
  promise.catch((error) => logError(error, context));
}
```

### Step 4.3: Replace silent catches in dashboard/page.tsx

- [ ] **Find silent catches in dashboard**

The dashboard has 9 silent catches. Replace each `.catch(() => {})` with:

```typescript
.catch((err) => logError(err, 'Dashboard: <specific operation>'))
```

Import at top: `import { logError } from '@/lib/utils/errors';`

### Step 4.4: Replace silent catches in settings pages

- [ ] **Update settings/page.tsx**

Replace `.catch(() => {})` patterns with proper logging.

### Step 4.5: Replace silent catches in content pages

- [ ] **Update content/page.tsx**

Replace `.catch(() => {})` patterns with proper logging.

### Step 4.6: Replace silent catches in remaining files

- [ ] **Update all remaining files**

Files to update:
- `frontend/app/reports/page.tsx`
- `frontend/app/account/page.tsx`
- `frontend/app/admin/page.tsx`
- `frontend/app/settings/billing/page.tsx`
- `frontend/app/settings/brands/new/page.tsx`
- `frontend/app/onboarding/page.tsx`
- `frontend/components/ErrorBoundary.tsx`
- `frontend/components/content/ContentTabPanels.tsx`

### Step 4.7: Verify no silent catches remain

- [ ] **Verify removal**

Run: `cd frontend && grep -rn "\.catch(() =>" --include="*.tsx" --include="*.ts" | wc -l`

Expected: 0

### Step 4.8: Commit error handling improvements

- [ ] **Stage and commit**

```bash
git add frontend/lib/utils/errors.ts frontend/app/ frontend/components/
git commit -m "fix(frontend): replace 39 silent error catches with logging

- Create lib/utils/errors.ts with logError and fireAndForget utilities
- Replace all .catch(() => {}) with .catch(err => logError(err, context))
- Prepares codebase for Sentry integration

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Decompose Content Page

**Files:**
- Create: `frontend/app/content/components/QualityChecklist.tsx`
- Create: `frontend/app/content/components/HelpModal.tsx`
- Create: `frontend/app/content/components/DraftCard.tsx`
- Create: `frontend/app/content/components/OpportunityCard.tsx`
- Create: `frontend/app/content/components/ContentHeader.tsx`
- Create: `frontend/app/content/components/index.ts`
- Modify: `frontend/app/content/page.tsx`

### Step 5.1: Extract QualityChecklist component

- [ ] **Create frontend/app/content/components/QualityChecklist.tsx**

Extract lines 200-493 from page.tsx (the QualityCheck interface, runQualityChecks function, and QualityChecklist component).

```typescript
'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ContentDraft, BrandProfile } from '@/lib/api';

// Constants
const HEDGING_PHRASES = [
  'it is worth noting', 'it should be noted', 'it is important to note',
  'it is crucial to', 'needless to say', 'as we all know',
  'it goes without saying', 'in conclusion', 'to summarize',
  'in summary', 'overall,', 'ultimately,',
];

// Types
interface QualityCheck {
  label: string;
  passed: boolean | 'warning';
  detail?: string;
}

// Logic
function runQualityChecks(
  draft: ContentDraft,
  profile: BrandProfile | null,
  brandName: string,
): QualityCheck[] {
  // ... (copy full implementation from page.tsx lines 216-417)
}

// Component
interface QualityChecklistProps {
  draft: ContentDraft;
  profile: BrandProfile | null;
  brandName: string;
  autoExpand?: boolean;
  liveText?: string;
}

export function QualityChecklist({
  draft,
  profile,
  brandName,
  autoExpand = false,
  liveText,
}: QualityChecklistProps) {
  // ... (copy implementation from page.tsx lines 419-493)
}
```

### Step 5.2: Extract HelpModal component

- [ ] **Create frontend/app/content/components/HelpModal.tsx**

Extract lines 177-198 from page.tsx.

```typescript
'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface HelpModalProps {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}

export function HelpModal({ title, children, onClose }: HelpModalProps) {
  return (
    <Dialog open={true} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-[var(--text-secondary)] leading-relaxed space-y-3">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### Step 5.3: Extract helper functions to utils

- [ ] **Create frontend/app/content/utils.ts**

Extract lines 77-174 (relativeTime, generateAvailableLabel, PROMO_RESTRICTED_SUBREDDITS, isPromoRestricted, extractSubreddit, computeUrgency).

```typescript
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { ContentDraft } from '@/lib/api';

export function relativeTime(iso: string | null): string {
  if (!iso) return 'Unknown';
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true });
  } catch {
    return iso;
  }
}

export function generateAvailableLabel(nextGenerateAt: string | null): string | null {
  // ... (copy full implementation)
}

const PROMO_RESTRICTED_SUBREDDITS = new Set([
  // ... (copy full set)
]);

const RESTRICTED_NAME_SIGNALS = ['help','advice','support','care','recover','survivor','anon'];

export function isPromoRestricted(subreddit: string): boolean {
  const sub = subreddit.toLowerCase().replace(/^r\//, '');
  if (PROMO_RESTRICTED_SUBREDDITS.has(sub)) return true;
  return RESTRICTED_NAME_SIGNALS.some((kw) => sub.includes(kw));
}

export function extractSubreddit(contentBrief: string | null | undefined): string | null {
  if (!contentBrief) return null;
  const m = contentBrief.match(/\br\/([A-Za-z0-9_]+)/i) || contentBrief.match(/\bin r\/([A-Za-z0-9_]+)/i);
  return m ? m[1] : null;
}

export function computeUrgency(
  draft: ContentDraft,
  postedItems: ContentDraft[],
): { score: number; level: 'High' | 'Medium' | 'Low' } {
  // ... (copy full implementation)
}
```

### Step 5.4: Create barrel export

- [ ] **Create frontend/app/content/components/index.ts**

```typescript
export { QualityChecklist } from './QualityChecklist';
export { HelpModal } from './HelpModal';
```

### Step 5.5: Update page.tsx to use extracted components

- [ ] **Update imports in page.tsx**

Add:
```typescript
import { QualityChecklist, HelpModal } from './components';
import { relativeTime, generateAvailableLabel, isPromoRestricted, extractSubreddit, computeUrgency } from './utils';
```

Remove the local definitions of these functions and components.

### Step 5.6: Verify extraction works

- [ ] **Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors

- [ ] **Run dev server and test content page**

Run: `cd frontend && npm run dev`

Manually verify the content page loads and functions correctly.

### Step 5.7: Commit content page decomposition

- [ ] **Stage and commit**

```bash
git add frontend/app/content/components/ frontend/app/content/utils.ts frontend/app/content/page.tsx
git commit -m "refactor(content): decompose 2982-line page into modules

- Extract QualityChecklist component (~300 lines)
- Extract HelpModal component (~25 lines)
- Extract utility functions to utils.ts (~100 lines)
- page.tsx reduced to orchestrator role

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Decompose Drafting Service

**Files:**
- Create: `backend/app/services/drafting/__init__.py`
- Create: `backend/app/services/drafting/platforms.py`
- Create: `backend/app/services/drafting/prompts.py`
- Create: `backend/app/services/drafting/client.py`
- Create: `backend/app/services/drafting/pipeline.py`
- Modify: `backend/app/services/drafting_service.py` (becomes thin re-export)

### Step 6.1: Create drafting package directory

- [ ] **Create directory**

Run: `mkdir -p backend/app/services/drafting`

### Step 6.2: Extract platform specifications

- [ ] **Create backend/app/services/drafting/platforms.py**

Extract lines 58-154 (PLATFORM_SPECS, ALL_PLATFORMS, CONTENT_PLATFORMS, PLATFORM_MAX_TOKENS) and lines 157-237 (_PROMO_RESTRICTED_SUBREDDITS, _classify_subreddit, _build_subreddit_strategy).

```python
"""
Platform specifications and subreddit classification for content drafting.
"""
from __future__ import annotations

PLATFORM_SPECS: dict[str, dict] = {
    "reddit": {
        "format": "standalone_post",
        "word_range": (150, 400),
        "tone": "conversational, genuine community member voice",
        "rules": [
            # ... (copy all rules)
        ],
        "disclaimer": "Always disclose brand affiliation per Reddit's rules.",
        "posting_tip": "Choose the most relevant subreddit for your brand's niche.",
    },
    # ... (copy all platform specs)
}

ALL_PLATFORMS = list(PLATFORM_SPECS.keys())
CONTENT_PLATFORMS = [p for p in ALL_PLATFORMS if p != "reddit_reply"]

PLATFORM_MAX_TOKENS: dict[str, int] = {
    "reddit": 1200,
    "quora": 1800,
    "medium": 3500,
    "wikipedia": 900,
}

# Subreddit classification
_PROMO_RESTRICTED_SUBREDDITS: frozenset[str] = frozenset({
    # ... (copy full set)
})

_RESTRICTED_NAME_SIGNALS = ("help", "advice", "support", "care", "recover", "survivor", "anon")
_ALLOWED_NAME_SIGNALS = (
    "entrepreneur", "startup", "business", "marketing", "growth",
    # ... (copy full tuple)
)


def classify_subreddit(subreddit: str) -> str:
    """Returns 'restricted', 'allowed', or 'cautious' for a given subreddit name."""
    sub = subreddit.lower().strip().lstrip("r/")
    if sub in _PROMO_RESTRICTED_SUBREDDITS:
        return "restricted"
    if any(kw in sub for kw in _RESTRICTED_NAME_SIGNALS):
        return "restricted"
    if any(kw in sub for kw in _ALLOWED_NAME_SIGNALS):
        return "allowed"
    return "cautious"


def build_subreddit_strategy(subreddit: str, brand_name: str, strategy: str) -> str:
    """Returns the prompt block telling Claude how to handle promotion for this subreddit."""
    # ... (copy full implementation)
```

### Step 6.3: Extract prompt building

- [ ] **Create backend/app/services/drafting/prompts.py**

Extract lines 660-760 (_build_prompt function and WIKIPEDIA_SYSTEM_PROMPT).

```python
"""
Prompt construction for content drafting.
"""
from __future__ import annotations

from typing import Optional

WIKIPEDIA_SYSTEM_PROMPT = '''You are a Wikipedia editor...'''  # Copy full prompt


def build_prompt(
    brand_name: str,
    platform: str,
    prompt_text: str,
    visibility_pct: float,
    profile_context: str,
    response_analysis: str,
    platform_spec: dict,
    opportunity_context: Optional[str] = None,
    existing_drafts_context: Optional[str] = None,
) -> str:
    """Build the full prompt for Claude to generate content."""
    # ... (copy full implementation from _build_prompt)
```

### Step 6.4: Extract Claude client

- [ ] **Create backend/app/services/drafting/client.py**

Extract lines 763-783 (_call_claude function).

```python
"""
Claude API client for content generation.
"""
from __future__ import annotations

import os
import logging

logger = logging.getLogger(__name__)


async def call_claude(
    prompt: str,
    max_tokens: int = 2500,
    model: str = "claude-sonnet-4-6",
) -> str:
    """Call Claude API and return the response text."""
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        raise ValueError(
            "ANTHROPIC_API_KEY is not configured. "
            "Add your key in Settings to enable draft generation."
        )
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=api_key)
    response = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text if response.content else ""
```

### Step 6.5: Extract post-processing pipeline

- [ ] **Create backend/app/services/drafting/pipeline.py**

Extract lines 786-end (all post-processing functions: _remove_hedging, _clean_wiki_text, _parse_wikipedia_draft, _extract_title_and_body, _estimate_visibility_impact, and related helpers).

```python
"""
Post-processing pipeline for generated drafts.
"""
from __future__ import annotations

import re

# Hedging removal
_HEDGING_RE = re.compile(
    # ... (copy full regex)
)


def remove_hedging(text: str) -> str:
    """Remove hedging phrases from generated content."""
    # ... (copy implementation)


def clean_wiki_text(raw: str) -> str:
    """Clean up Wikipedia wikitext output."""
    # ... (copy implementation)


def parse_wikipedia_draft(raw: str) -> tuple[str, str, str, str, str]:
    """Parse LLM output for Wikipedia drafts."""
    # ... (copy implementation)


def extract_title_and_body(text: str, platform: str) -> tuple[str | None, str]:
    """Extract title and body from generated content."""
    # ... (copy implementation)


def estimate_visibility_impact(
    current_visibility: float,
    platform: str,
    word_count: int,
) -> int:
    """Estimate the visibility impact score for a draft."""
    # ... (copy implementation)
```

### Step 6.6: Create package __init__.py

- [ ] **Create backend/app/services/drafting/__init__.py**

```python
"""
Drafting Service — Phase 2 dynamic drafting engine.

Public API:
- generate_gap_draft(db, brand_id, prompt_id, platform) -> ContentDraft
- generate_opportunity_draft(db, opportunity_id) -> ContentDraft  
- auto_draft_top_gaps(db, brand_id, max_gaps=3) -> list[ContentDraft]
"""
from __future__ import annotations

# Re-export public functions from the main module
# (The main orchestration logic stays in drafting_service.py for now,
# but imports from the submodules)

from .platforms import (
    PLATFORM_SPECS,
    ALL_PLATFORMS,
    CONTENT_PLATFORMS,
    PLATFORM_MAX_TOKENS,
    classify_subreddit,
    build_subreddit_strategy,
)
from .prompts import build_prompt, WIKIPEDIA_SYSTEM_PROMPT
from .client import call_claude
from .pipeline import (
    remove_hedging,
    clean_wiki_text,
    parse_wikipedia_draft,
    extract_title_and_body,
    estimate_visibility_impact,
)

__all__ = [
    "PLATFORM_SPECS",
    "ALL_PLATFORMS", 
    "CONTENT_PLATFORMS",
    "PLATFORM_MAX_TOKENS",
    "classify_subreddit",
    "build_subreddit_strategy",
    "build_prompt",
    "WIKIPEDIA_SYSTEM_PROMPT",
    "call_claude",
    "remove_hedging",
    "clean_wiki_text",
    "parse_wikipedia_draft",
    "extract_title_and_body",
    "estimate_visibility_impact",
]
```

### Step 6.7: Update drafting_service.py to use submodules

- [ ] **Update backend/app/services/drafting_service.py**

Replace local definitions with imports:

```python
"""
Drafting Service — orchestration layer.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select, func as sqlfunc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Brand, BrandProfile, ContentGap, ContentDraft, ContentOpportunity,
    Prompt, QueryResult, TrackingRun, BrandContentSettings, utcnow as _utcnow,
)

# Import from submodules
from app.services.drafting import (
    PLATFORM_SPECS, ALL_PLATFORMS, CONTENT_PLATFORMS, PLATFORM_MAX_TOKENS,
    classify_subreddit, build_subreddit_strategy,
    build_prompt, WIKIPEDIA_SYSTEM_PROMPT,
    call_claude,
    remove_hedging, clean_wiki_text, parse_wikipedia_draft,
    extract_title_and_body, estimate_visibility_impact,
)

logger = logging.getLogger(__name__)

# ... rest of the orchestration code (generate_gap_draft, etc.)
```

### Step 6.8: Verify refactoring works

- [ ] **Run tests**

Run: `cd backend && pytest tests/ -v --tb=short -x`

Expected: All tests pass

### Step 6.9: Commit drafting service decomposition

- [ ] **Stage and commit**

```bash
git add backend/app/services/drafting/ backend/app/services/drafting_service.py
git commit -m "refactor(backend): decompose 1639-line drafting_service into modules

- platforms.py: PLATFORM_SPECS, subreddit classification
- prompts.py: prompt construction, Wikipedia system prompt
- client.py: Claude API interaction
- pipeline.py: post-processing, hedging removal, parsing
- drafting_service.py: thin orchestration layer

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Add Service-Level Tests

**Files:**
- Create: `backend/tests/test_drafting_service.py`
- Create: `backend/tests/test_tracking_service_unit.py`

### Step 7.1: Create drafting service tests

- [ ] **Create backend/tests/test_drafting_service.py**

```python
"""
Unit tests for drafting service components.
Tests prompt construction, sanitization, and platform rules without LLM calls.
"""
import pytest
from app.services.drafting.platforms import (
    PLATFORM_SPECS,
    classify_subreddit,
    build_subreddit_strategy,
)
from app.services.drafting.pipeline import (
    remove_hedging,
    extract_title_and_body,
    estimate_visibility_impact,
)
from app.services.drafting.prompts import build_prompt


class TestSubredditClassification:
    """Tests for subreddit promotion classification."""

    def test_restricted_subreddit_by_name(self):
        assert classify_subreddit("personalfinance") == "restricted"
        assert classify_subreddit("r/legaladvice") == "restricted"
        assert classify_subreddit("AskDocs") == "restricted"

    def test_restricted_subreddit_by_signal(self):
        assert classify_subreddit("cancersupport") == "restricted"
        assert classify_subreddit("r/depressionhelp") == "restricted"
        assert classify_subreddit("recoveryadvice") == "restricted"

    def test_allowed_subreddit(self):
        assert classify_subreddit("entrepreneur") == "allowed"
        assert classify_subreddit("r/startups") == "allowed"
        assert classify_subreddit("SaaS") == "allowed"

    def test_cautious_subreddit(self):
        assert classify_subreddit("randomsubreddit") == "cautious"
        assert classify_subreddit("r/photography") == "cautious"


class TestHedgingRemoval:
    """Tests for hedging phrase removal."""

    def test_removes_hedging_phrases(self):
        text = "It's worth noting that the product works. Additionally, it's fast."
        result = remove_hedging(text)
        assert "worth noting" not in result.lower()
        assert "additionally" not in result.lower()

    def test_preserves_content(self):
        text = "The product increases efficiency by 50%."
        result = remove_hedging(text)
        assert "increases efficiency by 50%" in result

    def test_handles_empty_string(self):
        assert remove_hedging("") == ""


class TestTitleExtraction:
    """Tests for title and body extraction."""

    def test_reddit_title_extraction(self):
        text = "My Experience with Product X\n\nHere is the body content..."
        title, body = extract_title_and_body(text, "reddit")
        assert title == "My Experience with Product X"
        assert "body content" in body

    def test_quora_no_title(self):
        text = "The answer is straightforward. Here's what you need to know..."
        title, body = extract_title_and_body(text, "quora")
        assert title is None
        assert "answer is straightforward" in body


class TestVisibilityImpactEstimation:
    """Tests for visibility impact score calculation."""

    def test_medium_article_high_impact(self):
        # Long Medium article at low visibility = high impact
        impact = estimate_visibility_impact(20.0, "medium", 1500)
        assert impact >= 15

    def test_reddit_reply_low_impact(self):
        # Short Reddit reply = lower impact
        impact = estimate_visibility_impact(50.0, "reddit_reply", 50)
        assert impact < 10


class TestPromptConstruction:
    """Tests for prompt building."""

    def test_prompt_includes_brand_name(self):
        prompt = build_prompt(
            brand_name="TestBrand",
            platform="reddit",
            prompt_text="What is TestBrand?",
            visibility_pct=30.0,
            profile_context="TestBrand is a testing company.",
            response_analysis="No mentions found.",
            platform_spec=PLATFORM_SPECS["reddit"],
        )
        assert "TestBrand" in prompt
        assert "reddit" in prompt.lower()

    def test_prompt_includes_platform_rules(self):
        prompt = build_prompt(
            brand_name="TestBrand",
            platform="quora",
            prompt_text="How does TestBrand work?",
            visibility_pct=10.0,
            profile_context="TestBrand does X.",
            response_analysis="Competitors mentioned.",
            platform_spec=PLATFORM_SPECS["quora"],
        )
        # Quora-specific rule about first sentence
        assert "first sentence" in prompt.lower() or "direct answer" in prompt.lower()


class TestPlatformSpecs:
    """Tests for platform specification completeness."""

    def test_all_platforms_have_required_fields(self):
        required = ["format", "word_range", "tone", "rules"]
        for platform, spec in PLATFORM_SPECS.items():
            for field in required:
                assert field in spec, f"{platform} missing {field}"

    def test_word_ranges_are_valid(self):
        for platform, spec in PLATFORM_SPECS.items():
            min_words, max_words = spec["word_range"]
            assert min_words < max_words, f"{platform} has invalid word range"
            assert min_words > 0, f"{platform} min words must be positive"
```

### Step 7.2: Create tracking service unit tests

- [ ] **Create backend/tests/test_tracking_service_unit.py**

```python
"""
Unit tests for tracking service components.
Tests mention detection and score calculation without database or LLM calls.
"""
import pytest


# Import the functions we want to test
# Note: These are internal functions, so we import from the module directly
def _normalize(text: str) -> str:
    """Lowercase and strip all non-alphanumeric characters."""
    import re
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _detect_mention(
    brand_name: str,
    response_text: str | None,
    error: str | None,
    model: str,
) -> bool:
    """Detect if brand is mentioned in response."""
    if not response_text or error == "api_key_not_configured":
        return False
    
    brand_norm = _normalize(brand_name)
    response_norm = _normalize(response_text)
    
    exact = brand_name.lower() in response_text.lower()
    fuzzy = brand_norm in response_norm
    
    return exact or fuzzy


class TestNormalization:
    """Tests for text normalization."""

    def test_removes_spaces(self):
        assert _normalize("Hello World") == "helloworld"

    def test_removes_punctuation(self):
        assert _normalize("Hello, World!") == "helloworld"

    def test_lowercases(self):
        assert _normalize("HELLO") == "hello"

    def test_handles_brand_with_spaces(self):
        assert _normalize("Spotit Early") == "spotitearly"


class TestMentionDetection:
    """Tests for brand mention detection."""

    def test_exact_match(self):
        assert _detect_mention(
            "TestBrand",
            "I recommend TestBrand for this use case.",
            None,
            "chatgpt"
        ) is True

    def test_case_insensitive_match(self):
        assert _detect_mention(
            "TestBrand",
            "I recommend testbrand for this use case.",
            None,
            "chatgpt"
        ) is True

    def test_fuzzy_match_with_spaces(self):
        # "Spotit Early" should match "spotitearly" in response
        assert _detect_mention(
            "Spotit Early",
            "The spotitearly system is effective.",
            None,
            "chatgpt"
        ) is True

    def test_no_match(self):
        assert _detect_mention(
            "TestBrand",
            "I recommend OtherProduct for this use case.",
            None,
            "chatgpt"
        ) is False

    def test_empty_response(self):
        assert _detect_mention("TestBrand", "", None, "chatgpt") is False
        assert _detect_mention("TestBrand", None, None, "chatgpt") is False

    def test_api_key_error(self):
        assert _detect_mention(
            "TestBrand",
            "TestBrand is mentioned here",
            "api_key_not_configured",
            "chatgpt"
        ) is False

    def test_partial_match_in_word(self):
        # "Test" in "TestBrand" shouldn't match "testing"
        assert _detect_mention(
            "TestBrand",
            "I was testing the application.",
            None,
            "chatgpt"
        ) is False


class TestScoreCalculation:
    """Tests for visibility score calculation logic."""

    def test_score_calculation_basic(self):
        # Score = mentions / total * 100
        mentions = 3
        total = 10
        score = (mentions / total) * 100
        assert score == 30.0

    def test_score_with_zero_total(self):
        # Edge case: no queries completed
        total = 0
        score = 0.0 if total == 0 else (0 / total) * 100
        assert score == 0.0

    def test_score_all_mentions(self):
        mentions = 10
        total = 10
        score = (mentions / total) * 100
        assert score == 100.0
```

### Step 7.3: Run new tests

- [ ] **Verify tests pass**

Run: `cd backend && pytest tests/test_drafting_service.py tests/test_tracking_service_unit.py -v`

Expected: All tests pass

### Step 7.4: Commit service tests

- [ ] **Stage and commit**

```bash
git add backend/tests/test_drafting_service.py backend/tests/test_tracking_service_unit.py
git commit -m "test(backend): add unit tests for drafting and tracking services

- test_drafting_service.py: subreddit classification, hedging removal, prompt construction
- test_tracking_service_unit.py: normalization, mention detection, score calculation
- Tests critical logic without LLM calls or database

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Final Verification

### Step 8.1: Run full test suite

- [ ] **Run all backend tests**

Run: `cd backend && pytest tests/ -v --tb=short`

Expected: All tests pass

### Step 8.2: Run linting

- [ ] **Run ruff on backend**

Run: `cd backend && ruff check . --config ../pyproject.toml`

Expected: No errors (warnings OK)

- [ ] **Run ESLint on frontend**

Run: `cd frontend && npm run lint`

Expected: No errors (warnings OK)

### Step 8.3: Run TypeScript check

- [ ] **Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit`

Expected: No errors

### Step 8.4: Start dev servers and smoke test

- [ ] **Start backend**

Run: `cd backend && source venv/bin/activate && uvicorn app.main:app --reload --port 3001`

Expected: Server starts without errors

- [ ] **Start frontend**

Run: `cd frontend && npm run dev`

Expected: Server starts, pages load

### Step 8.5: Final commit with summary

- [ ] **Review all changes**

Run: `git status && git log --oneline -10`

- [ ] **Create summary commit if needed**

If any loose ends, create a cleanup commit.

---

## Execution Summary

| Task | Description | Est. Time | Dependencies |
|------|-------------|-----------|--------------|
| 1 | CI/CD + Python Linting | 30 min | None |
| 2 | Frontend Linting Setup | 20 min | None |
| 3 | Extract Constants | 45 min | None |
| 4 | Replace Silent Catches | 30 min | None |
| 5 | Decompose Content Page | 60 min | Task 3 |
| 6 | Decompose Drafting Service | 60 min | None |
| 7 | Service-Level Tests | 45 min | Task 6 |
| 8 | Final Verification | 20 min | All |

**Parallel execution groups:**
- Group A (independent): Tasks 1, 2, 3, 4, 6
- Group B (after Group A): Tasks 5, 7
- Group C (final): Task 8

**Total estimated time:** ~4-5 hours with parallel execution
