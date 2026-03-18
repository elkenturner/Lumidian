"""
ClarityAI — FastAPI application entry point.

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
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

# Load .env before any module reads os.getenv().
# Resolve relative to this file so it works regardless of cwd.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import create_tables, run_migrations
from app.scheduler import start_scheduler, stop_scheduler
from app.routers import brands, tracking, results, content, accounts, dashboard
from app.routers import brand_profile, gaps, opportunities, settings
from app.routers import auth as auth_router, billing as billing_router
from app.routers import analytics as analytics_router
from app.schemas import HealthResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    if google_client_id:
        logger.info("Google OAuth: GOOGLE_CLIENT_ID loaded (%s…)", google_client_id[:20])
    else:
        logger.warning("Google OAuth: GOOGLE_CLIENT_ID is NOT set — /api/auth/google will be unavailable")

    logger.info("ClarityAI startup: creating database tables...")
    await create_tables()
    await run_migrations()
    logger.info("Database tables ready.")

    # Seed admin user
    from app.services.auth_seeder import seed_admin_user
    await seed_admin_user()

    logger.info("Starting background scheduler...")
    start_scheduler()

    yield  # Application runs here

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("ClarityAI shutdown: stopping scheduler...")
    stop_scheduler()
    logger.info("Scheduler stopped. Goodbye.")


app = FastAPI(
    title="ClarityAI",
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

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/api/health", response_model=HealthResponse, tags=["health"])
async def health():
    return HealthResponse(
        status="ok",
        version="1.0.0",
        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
    )
