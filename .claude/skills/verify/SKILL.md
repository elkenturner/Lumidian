---
name: verify
description: How to stand up a throwaway local Lumidian stack (copied dev DB, backend + frontend on scratch ports) and browser-drive a change end-to-end.
---

# Verifying Lumidian changes locally

Recipe that works (2026-07-06). Goal: run the app against a **copy** of the
dev DB so destructive flows are safe, on ports that never collide with
Ken's real dev servers (3000-3002, 8000-8001) or other Claude sessions.

## Stand up the stack

```bash
SCRATCH=<session scratchpad dir>

# 1. Copy the dev DB (the real one lives in the MAIN checkout, not worktrees)
cp /Users/ken/Desktop/Lumidian/backend/clarity_ai.db $SCRATCH/verify.db

# 2. Backend .env — copy from the main checkout if the worktree lacks one
cp /Users/ken/Desktop/Lumidian/backend/.env <worktree>/backend/.env

# 3. Backend on 8003 (venv lives in the MAIN checkout only)
cd <worktree>/backend
DATABASE_URL="sqlite+aiosqlite:///$SCRATCH/verify.db" \
  /Users/ken/Desktop/Lumidian/backend/venv/bin/python \
  -m uvicorn app.main:app --port 8003 > $SCRATCH/backend.log 2>&1 &

# 4. Frontend on 3003, proxying to 8003
cd <worktree>/frontend
BACKEND_URL=http://localhost:8003 PORT=3003 npm run dev > $SCRATCH/frontend.log 2>&1 &

curl -s http://localhost:8003/api/health   # {"status":"ok",...}
```

## Auth

localhost cookies are shared across ports, so an existing dev login usually
carries over. If not, set a known password directly in the DB **copy**:

```bash
HASH=$(venv python -c "import bcrypt; print(bcrypt.hashpw(b'verify-pass-123', bcrypt.gensalt()).decode())")
sqlite3 $SCRATCH/verify.db "UPDATE users SET password_hash='$HASH', email_verified=1, totp_enabled=0 WHERE id=<n>;"
```

## Good test data (local dev DB)

- Brand 2 = Manhattan Street Capital (user 3), cluster 6 has a full 6-piece
  draft set; the owned_site piece has been posted + pillar-attached at least
  once — ideal for posted/pillar flows.
- Verify DB-level effects with `sqlite3 $SCRATCH/verify.db` after UI actions.

## Gotchas

- **Kill servers by PID / pkill pattern, not `kill %1`** — each Bash tool
  call is a fresh shell with no job table. A stale uvicorn silently keeps
  the port and serves OLD code; `lsof -nP -iTCP:8003 -sTCP:LISTEN` +
  `ps -o lstart=` to check age before trusting a restart.
- Backend schema/router changes need a backend restart (no reload flag in
  this recipe).
- `frontend/next-env.d.ts` gets rewritten by the dev server
  (`.next/dev/types/...`) — `git checkout` it before finishing.
- Playwright MCP screenshots land in the **worktree root** — move them to
  the scratchpad when done.
- Console will show HMR-websocket + prod-tab noise (lumidian.ai CSP/Sentry
  errors) — judge only the per-navigation error count for the page under
  test.
