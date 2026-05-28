#!/usr/bin/env bash
# Count hardcoded color literals in frontend code.
# Excludes design-token values and lib/constants/models.ts (model brand colors are data).
set -euo pipefail

ROOT="${1:-frontend}"

HARDCODED=$(grep -rEo "#[0-9a-fA-F]{6}|rgba?\([0-9., ]+\)" \
  --include="*.tsx" --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  --exclude="*models.ts" \
  "$ROOT/app/" "$ROOT/components/" 2>/dev/null | wc -l | tr -d ' ')

TOKENS=$(grep -rEo "var\(--[a-z-]+\)" \
  --include="*.tsx" --include="*.ts" \
  --exclude-dir=node_modules \
  --exclude-dir=.next \
  "$ROOT/app/" "$ROOT/components/" 2>/dev/null | wc -l | tr -d ' ')

TOTAL=$((HARDCODED + TOKENS))
PCT=$(awk "BEGIN { printf \"%.1f\", ($HARDCODED / $TOTAL) * 100 }")

echo "Hardcoded color literals: $HARDCODED"
echo "Design token usages:      $TOKENS"
echo "Slippage:                 ${PCT}%"
