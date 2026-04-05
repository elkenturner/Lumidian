"""
Lumidian — FastAPI application entry point.

Lifespan:
  - Creates all database tables on startup.
  - Starts the APScheduler background scheduler.
  - Stops the scheduler cleanly on shutdown.

CORS:
  - Allows requests from http://localhost:3000 and http://localhost:3001 (front-end dev servers).

Routers:
  - /api/brands     — brand & prompt CRUD
  - /api/tracking   — trigger and monitor tracking runs
  - /api/results    — analytics and response data
  - /api/dashboard  — rich dashboard analytics (SOV, sentiment, position, competitor comparison)
  - /api/health     — liveness check
"""

import logging
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

# Load .env before any module reads os.getenv().
# Resolve relative to this file so it works regardless of cwd.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.database import cleanup_stale_runs, create_tables, run_migrations
from app.routers import (
    accounts,
    brand_profile,
    brands,
    content,
    dashboard,
    gaps,
    opportunities,
    results,
    settings,
    tracking,
)
from app.routers import analytics as analytics_router
from app.routers import auth as auth_router
from app.routers import billing as billing_router
from app.routers import errors as errors_router
from app.routers import notifications as notifications_router
from app.routers import reports as reports_router
from app.routers import support as support_router
from app.routers import team as team_router
from app.scheduler import start_scheduler, stop_scheduler
from app.schemas import HealthResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

from app.logging_config import configure_logging

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    # Validate required environment variables
    missing = [v for v in ("JWT_SECRET", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET") if not os.getenv(v)]
    if missing:
        logger.warning("Missing recommended env vars: %s — some features may be unavailable", ", ".join(missing))

    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if google_client_id:
        logger.info("Google OAuth: GOOGLE_CLIENT_ID loaded (%s…)", google_client_id[:20])
    else:
        logger.warning("Google OAuth: GOOGLE_CLIENT_ID is NOT set — /api/auth/google will be unavailable")

    logger.info("Lumidian startup: creating database tables...")
    await create_tables()
    await run_migrations()
    await cleanup_stale_runs()
    logger.info("Database tables ready.")

    # Seed admin user
    from app.services.auth_seeder import seed_admin_user
    await seed_admin_user()

    logger.info("Starting background scheduler...")
    start_scheduler()

    yield  # Application runs here

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("Lumidian shutdown: stopping scheduler...")
    stop_scheduler()
    logger.info("Scheduler stopped. Goodbye.")


app = FastAPI(
    title="Lumidian",
    description=(
        "Track brand visibility in AI-generated responses across "
        "ChatGPT, Claude, Perplexity, and Gemini."
    ),
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

# ── Global exception handler ──────────────────────────────────────────────────
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


# ── CORS ──────────────────────────────────────────────────────────────────────
# Set ALLOWED_ORIGINS in .env as a comma-separated list.
# Include your ngrok URL there for remote testing, e.g.:
#   ALLOWED_ORIGINS=http://localhost:3000,https://abc123.ngrok-free.app
_raw_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001,http://localhost:3002,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3002")
_allowed_origins = [o.strip() for o in _raw_origins.split(",") if o.strip()]
logger.info(f"CORS allowed origins: {_allowed_origins}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "Cookie"],
)

from starlette.middleware.base import BaseHTTPMiddleware

_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_CSRF_EXEMPT_PREFIXES = ("/api/billing/webhook",)


class CSRFOriginMiddleware(BaseHTTPMiddleware):
    """Reject state-changing requests from disallowed origins.
    Requests with no Origin header are allowed (non-browser clients)."""

    async def dispatch(self, request: Request, call_next):
        if request.method in _SAFE_METHODS:
            return await call_next(request)

        for prefix in _CSRF_EXEMPT_PREFIXES:
            if request.url.path.startswith(prefix):
                return await call_next(request)

        origin = request.headers.get("origin")
        if origin is not None and origin not in _allowed_origins:
            logger.warning(f"CSRF rejected: origin={origin} not in {_allowed_origins}")
            return JSONResponse(
                status_code=403,
                content={"detail": "Forbidden: cross-origin request rejected"},
            )

        return await call_next(request)


app.add_middleware(CSRFOriginMiddleware)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(brands.router, prefix="/api")
app.include_router(brand_profile.router, prefix="/api")
app.include_router(tracking.router, prefix="/api")
app.include_router(results.router, prefix="/api")
app.include_router(content.router, prefix="/api")
app.include_router(accounts.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(gaps.router, prefix="/api")
app.include_router(opportunities.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(auth_router.router, prefix="/api")
app.include_router(billing_router.router, prefix="/api")
app.include_router(analytics_router.router, prefix="/api")
app.include_router(reports_router.router, prefix="/api")
app.include_router(team_router.router, prefix="/api")
app.include_router(errors_router.router, prefix="/api")
app.include_router(notifications_router.router, prefix="/api")
app.include_router(support_router.router, prefix="/api")


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/api/health", response_model=HealthResponse, tags=["health"])
async def health():
    return HealthResponse(
        status="ok",
        version="1.0.0",
        timestamp=datetime.now(UTC).replace(tzinfo=None),
    )
