import logging
import os
from datetime import UTC

from dotenv import load_dotenv
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

logger = logging.getLogger(__name__)

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./clarity_ai.db")

_is_sqlite = "sqlite" in DATABASE_URL

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    **({} if _is_sqlite else {
        "pool_size": 10,
        "max_overflow": 20,
        "pool_timeout": 30,
        "pool_recycle": 1800,
    }),
)

# Enable FK constraints for every new SQLite connection (aiosqlite uses the sync
# driver under the hood, so the sync `connect` event fires reliably).
if "sqlite" in DATABASE_URL:

    @event.listens_for(engine.sync_engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def create_tables():
    async with engine.begin() as conn:
        from app import models  # noqa: F401 - ensures models are registered
        await conn.run_sync(Base.metadata.create_all)


async def run_migrations():
    """Apply incremental schema changes for databases created before a migration."""
    from sqlalchemy import text

    migrations = [
        # Added in sentiment tracking feature
        "ALTER TABLE query_results ADD COLUMN sentiment TEXT",
        # Added in brand profile feature
        """CREATE TABLE IF NOT EXISTS brand_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_id INTEGER NOT NULL UNIQUE REFERENCES brands(id) ON DELETE CASCADE,
            company_description TEXT,
            key_stats TEXT,
            tone_of_voice TEXT,
            what_not_to_say TEXT,
            target_audience TEXT,
            approved_language TEXT,
            created_at DATETIME,
            updated_at DATETIME
        )""",
        # Added in Phase 2 — Reddit opportunity scanner
        """CREATE TABLE IF NOT EXISTS content_opportunities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
            platform TEXT NOT NULL DEFAULT 'reddit',
            thread_url TEXT NOT NULL,
            thread_title TEXT,
            subreddit TEXT,
            body_preview TEXT,
            posted_at DATETIME,
            relevance_score REAL NOT NULL DEFAULT 0.0,
            prompt_id INTEGER REFERENCES prompts(id) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'new',
            created_at DATETIME
        )""",
        # Phase 2 — opportunity_id and estimated_impact on content_drafts
        "ALTER TABLE content_drafts ADD COLUMN opportunity_id INTEGER REFERENCES content_opportunities(id) ON DELETE SET NULL",
        "ALTER TABLE content_drafts ADD COLUMN estimated_impact REAL",
        # System-wide key-value settings (scheduler pause flag, etc.)
        """CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at DATETIME
        )""",
        # Publications field for Wikipedia citation sourcing
        "ALTER TABLE brand_profiles ADD COLUMN publications TEXT",
        # Added in content gap analysis feature
        """CREATE TABLE IF NOT EXISTS content_gaps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
            prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
            tracking_run_id INTEGER NOT NULL REFERENCES tracking_runs(id) ON DELETE CASCADE,
            model TEXT,
            severity_score REAL NOT NULL DEFAULT 0.0,
            opportunity_score REAL NOT NULL DEFAULT 0.0,
            recency_score REAL NOT NULL DEFAULT 0.0,
            gap_score REAL NOT NULL DEFAULT 0.0,
            competitor_mentions TEXT,
            platforms_lacking TEXT,
            prompt_visibility REAL,
            last_content_at DATETIME,
            identified_at DATETIME,
            created_at DATETIME
        )""",
        # Auth: users table
        """CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT,
            google_id TEXT UNIQUE,
            name TEXT,
            subscription_tier TEXT,
            subscription_status TEXT,
            stripe_customer_id TEXT,
            stripe_subscription_id TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME,
            updated_at DATETIME
        )""",
        # Auth: user_id on brands
        "ALTER TABLE brands ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        # Analytics event log
        """CREATE TABLE IF NOT EXISTS analytics_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            data TEXT,
            created_at DATETIME
        )""",
        # Draft lifecycle tracking columns
        "ALTER TABLE content_drafts ADD COLUMN approved_at DATETIME",
        "ALTER TABLE content_drafts ADD COLUMN dismissed_at DATETIME",
        "ALTER TABLE content_drafts ADD COLUMN posted_at DATETIME",
        "ALTER TABLE content_drafts ADD COLUMN edited_count INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE content_drafts ADD COLUMN time_to_approve_seconds INTEGER",
        # Multi-user isolation: assign orphaned brands to the admin user
        # (This migration is now a no-op since all orphaned brands were already reassigned
        # during initial deployment. Kept for historical migration idempotency.)
        """UPDATE brands SET user_id = (
            SELECT id FROM users WHERE email = COALESCE(NULL, '') LIMIT 1
        ) WHERE user_id IS NULL AND '' != ''""",
        # Website scraping: website_url on brands
        "ALTER TABLE brands ADD COLUMN website_url TEXT",
        # Website scraping: Jina-fetched context on brand_profiles
        "ALTER TABLE brand_profiles ADD COLUMN internal_brand_context TEXT",
        "ALTER TABLE brand_profiles ADD COLUMN website_context_last_fetched DATETIME",
        # Password reset tokens
        """CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token TEXT NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME
        )""",
        # Competitor website URL
        "ALTER TABLE competitors ADD COLUMN website_url TEXT",
        # Competitor mention tracking (no extra API calls — reuses QueryResult data)
        """CREATE TABLE IF NOT EXISTS competitor_mentions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tracking_run_id INTEGER NOT NULL REFERENCES tracking_runs(id) ON DELETE CASCADE,
            competitor_id INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
            prompt_id INTEGER NOT NULL REFERENCES prompts(id),
            model TEXT NOT NULL,
            run_number INTEGER NOT NULL,
            mentioned INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME
        )""",
        # Content post attribution — links content posts to visibility changes per run
        """CREATE TABLE IF NOT EXISTS content_attribution (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content_post_id INTEGER NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,
            tracking_run_id INTEGER NOT NULL REFERENCES tracking_runs(id) ON DELETE CASCADE,
            prompt_id INTEGER NOT NULL REFERENCES prompts(id),
            brand_id INTEGER NOT NULL REFERENCES brands(id),
            visibility_before REAL,
            visibility_after REAL,
            improvement_pct REAL,
            measured_at DATETIME NOT NULL,
            created_at DATETIME
        )""",
        # Content performance tracking — draft attribution
        """CREATE TABLE IF NOT EXISTS draft_attributions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            draft_id INTEGER NOT NULL REFERENCES content_drafts(id) ON DELETE CASCADE,
            brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
            prompt_id INTEGER REFERENCES prompts(id) ON DELETE SET NULL,
            posted_at DATETIME NOT NULL,
            score_at_posting REAL,
            current_score REAL,
            delta REAL,
            runs_since_posting INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME,
            updated_at DATETIME
        )""",
        # Team members for multi-user access
        """CREATE TABLE IF NOT EXISTS team_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            invited_email TEXT NOT NULL,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            role TEXT NOT NULL DEFAULT 'viewer',
            invite_token TEXT NOT NULL UNIQUE,
            invited_at DATETIME,
            accepted_at DATETIME,
            expires_at DATETIME NOT NULL
        )""",
        # Performance indexes — speed up dashboard/reports queries
        "CREATE INDEX IF NOT EXISTS idx_tracking_runs_brand_status ON tracking_runs(brand_id, status, completed_at)",
        "CREATE INDEX IF NOT EXISTS idx_query_results_run_id ON query_results(tracking_run_id)",
        "CREATE INDEX IF NOT EXISTS idx_query_results_run_text ON query_results(tracking_run_id, response_text)",
        "CREATE INDEX IF NOT EXISTS idx_opportunities_brand_status ON content_opportunities(brand_id, status)",
        "ALTER TABLE content_drafts ADD COLUMN visibility_at_post REAL",
        # Pitch brand support: brand_type + expiry, and prompt type labelling
        "ALTER TABLE brands ADD COLUMN brand_type TEXT NOT NULL DEFAULT 'standard'",
        "ALTER TABLE brands ADD COLUMN pitch_expires_at DATETIME",
        "ALTER TABLE prompts ADD COLUMN prompt_type TEXT NOT NULL DEFAULT 'standard'",
        # Notification center
        """CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            body TEXT,
            link TEXT,
            read INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME
        )""",
        "CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read, created_at)",
        # Quora question suggestions stored per content gap
        "ALTER TABLE content_gaps ADD COLUMN quora_questions TEXT",
        # Admin user management — pause and trial-end tracking
        "ALTER TABLE users ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN subscription_trial_end DATETIME",
        # Index for efficient daily manual run count query (used in plan enforcement)
        "CREATE INDEX IF NOT EXISTS idx_tracking_runs_manual_daily ON tracking_runs(brand_id, run_type, created_at)",
        # Track whether a draft was created by the scheduler or by a user manually
        "ALTER TABLE content_drafts ADD COLUMN source TEXT",
        "CREATE INDEX IF NOT EXISTS idx_content_drafts_source ON content_drafts(brand_id, source, created_at)",
        # Two-factor authentication (TOTP)
        "ALTER TABLE users ADD COLUMN totp_secret TEXT",
        "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0",
        # Email verification — gate new accounts until they confirm their address
        "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1",
        "ALTER TABLE users ADD COLUMN email_verification_code TEXT",
        "ALTER TABLE users ADD COLUMN email_verification_expires_at DATETIME",
        # Daily rate-limit for manual "Generate Drafts Now" button (once per 24h per brand)
        "ALTER TABLE brands ADD COLUMN last_manual_draft_at DATETIME",
        # Performance: content drafts filtered by brand + status (content page)
        "CREATE INDEX IF NOT EXISTS idx_content_drafts_brand_status ON content_drafts(brand_id, status)",
        # Performance: tracking runs sorted by brand + completion time (dashboard trend)
        "CREATE INDEX IF NOT EXISTS idx_tracking_runs_brand_completed ON tracking_runs(brand_id, completed_at DESC)",
        # Performance: notifications unread count (loaded on every page)
        "CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read) WHERE read = 0",
        # Performance: content gaps by brand (gap analysis page)
        "CREATE INDEX IF NOT EXISTS idx_content_gaps_brand ON content_gaps(brand_id, identified_at DESC)",
        # Performance: gap analysis page sorts by gap_score DESC
        "CREATE INDEX IF NOT EXISTS idx_content_gaps_brand_score ON content_gaps(brand_id, gap_score DESC)",
        # Performance: Quora scanner filters opportunities by brand + platform + status
        "CREATE INDEX IF NOT EXISTS idx_opportunities_brand_platform_status ON content_opportunities(brand_id, platform, status)",
        # Maintenance: drop the bloated idx_query_results_run_text which stored full response_text
        # in the B-tree (60 MB+ DB overhead). The tracking_run_id index alone is sufficient.
        "DROP INDEX IF EXISTS idx_query_results_run_text",
        # Performance: dashboard analytics sorts query_results by created_at DESC
        "CREATE INDEX IF NOT EXISTS idx_query_results_created ON query_results(created_at DESC)",
        # Performance: responses endpoint + dashboard analytics — filter by run, sort by created_at
        # Composite index lets SQLite serve both the equality/IN filter and the ORDER BY in one pass
        "CREATE INDEX IF NOT EXISTS idx_query_results_run_created ON query_results(tracking_run_id, created_at DESC)",
        # BrandContentSettings: drafting_frequency was added to DB but was missing from the ORM model
        "ALTER TABLE brand_content_settings ADD COLUMN drafting_frequency TEXT NOT NULL DEFAULT 'weekly'",
        # 2026-04-02: Add prompt_limit column to brands
        "ALTER TABLE brands ADD COLUMN prompt_limit INTEGER DEFAULT 25",
        # 2026-04-07: Content Impact Intelligence tables
        "CREATE TABLE IF NOT EXISTS prompt_run_scores (id INTEGER PRIMARY KEY, prompt_id INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE, tracking_run_id INTEGER NOT NULL REFERENCES tracking_runs(id) ON DELETE CASCADE, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE, model TEXT NOT NULL, score REAL NOT NULL, mentioned_count INTEGER NOT NULL, query_count INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(prompt_id, tracking_run_id, model))",
        "CREATE INDEX IF NOT EXISTS idx_prompt_run_scores_prompt_model ON prompt_run_scores(prompt_id, model, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_prompt_run_scores_brand ON prompt_run_scores(brand_id, created_at)",
        "CREATE TABLE IF NOT EXISTS content_events (id INTEGER PRIMARY KEY, brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE, prompt_id INTEGER REFERENCES prompts(id) ON DELETE SET NULL, event_type TEXT NOT NULL, data TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)",
        "CREATE INDEX IF NOT EXISTS idx_content_events_brand_type ON content_events(brand_id, event_type, created_at)",
        "CREATE INDEX IF NOT EXISTS idx_content_events_prompt ON content_events(prompt_id, created_at)",
        # 2026-04-10: (removed) Stale RENAME migration — draft_attributions table
        # already created with the correct name by CREATE TABLE above.
        # 2026-04-10: Ensure error_message column exists on tracking_runs (ORM had it, migration was missing)
        "ALTER TABLE tracking_runs ADD COLUMN error_message TEXT",
        # 2026-04-10: Add user_id to account_connections for multi-tenancy
        "ALTER TABLE account_connections ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE",
        # 2026-04-10: Add password_changed_at for session invalidation after password change
        "ALTER TABLE users ADD COLUMN password_changed_at DATETIME",
        # 2026-04-11: Persistent rate limiting — survives container restarts
        """CREATE TABLE IF NOT EXISTS rate_limits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            created_at REAL NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_rate_limits_key_endpoint ON rate_limits(key, endpoint, created_at)",
        # 2026-04-11: Stripe webhook idempotency — prevent duplicate event processing on retries
        """CREATE TABLE IF NOT EXISTS processed_webhook_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            stripe_event_id TEXT NOT NULL UNIQUE,
            event_type TEXT NOT NULL,
            processed_at DATETIME NOT NULL
        )""",
        "CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_stripe_id ON processed_webhook_events(stripe_event_id)",
        # 2026-04-16: Admin tier override — prevents Stripe webhooks from reverting admin-set tiers
        "ALTER TABLE users ADD COLUMN admin_tier_override INTEGER NOT NULL DEFAULT 0",
    ]
    from sqlalchemy.exc import OperationalError
    async with engine.begin() as conn:
        for stmt in migrations:
            try:
                await conn.execute(text(stmt))
                logger.info("Migration applied: %s", stmt)
            except OperationalError:
                # Column/table/index already exists — safe to ignore
                pass

    # ── Idempotent data fixes (run every startup) ────────────────────────────
    async with engine.begin() as conn:
        # Ensure brands match their owner's subscription tier.
        # Catches pitch brands that weren't upgraded due to webhook race,
        # AND brands where brand_type was changed but prompt_limit wasn't.
        # Sync Pro user brands to brand_type='pro'.  For prompt_limit:
        #  - Brand at old default of 100 with ≤30 prompts: lower to 30 (new cap).
        #  - Brand at 100 with >30 prompts: grandfather (leave at 100).
        await conn.execute(text(
            "UPDATE brands SET brand_type = 'pro' "
            "WHERE brand_type != 'pro' AND user_id IN "
            "(SELECT id FROM users WHERE subscription_tier = 'pro')"
        ))
        await conn.execute(text("""
            UPDATE brands SET prompt_limit = 30
            WHERE prompt_limit = 100
              AND user_id IN (SELECT id FROM users WHERE subscription_tier = 'pro')
              AND id NOT IN (
                SELECT brand_id FROM prompts
                GROUP BY brand_id HAVING COUNT(*) > 30
              )
        """))
        await conn.execute(text("""
            UPDATE brands SET brand_type = 'standard', prompt_limit = 25
            WHERE brand_type = 'pitch'
              AND user_id IN (SELECT id FROM users WHERE subscription_tier = 'starter')
        """))
        logger.info("Data fix: synced brand types/limits with user tiers")


async def cleanup_stale_runs(max_age_minutes: int = 15):
    """Mark tracking runs stuck in pending/running for > max_age_minutes as failed.

    Called on startup to clear runs that never completed (e.g., server crash).
    """
    from datetime import datetime, timedelta

    from sqlalchemy import and_, update

    from app.models import TrackingRun

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=max_age_minutes)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            update(TrackingRun)
            .where(
                and_(
                    TrackingRun.status.in_(["pending", "running"]),
                    TrackingRun.created_at < cutoff,
                )
            )
            .values(status="failed")
            .returning(TrackingRun.id)
        )
        stale_ids = result.scalars().all()
        await db.commit()
        if stale_ids:
            logger.info("Marked %d stale tracking runs as failed: %s", len(stale_ids), stale_ids)


async def fail_stale_runs_for_brand(db: AsyncSession, brand_id: int, max_age_minutes: int | None = None) -> None:
    """Auto-fail tracking runs stuck in pending/running for a specific brand.

    Called inline from endpoints that check for active runs, so a stuck run
    doesn't permanently block user actions (prompt edits, new tracking runs).

    If max_age_minutes is None (default), the threshold is calculated
    dynamically: estimated run time × 2, with a floor of 15 minutes.
    This prevents killing legitimate long runs for large brands while still
    catching stuck ones quickly for small brands.
    """
    from datetime import datetime, timedelta

    from sqlalchemy import func, select, update

    from app.models import Brand, Prompt, TrackingRun

    if max_age_minutes is None:
        # Calculate expected run duration from prompt count + tier
        brand_result = await db.execute(select(Brand).where(Brand.id == brand_id))
        brand = brand_result.scalar_one_or_none()
        prompt_count_result = await db.execute(
            select(func.count(Prompt.id)).where(Prompt.brand_id == brand_id)
        )
        prompt_count = prompt_count_result.scalar_one() or 1

        tier_runs = {"basic": 3, "standard": 3, "premium": 3}
        runs_per_prompt = tier_runs.get(brand.tier, 3) if brand else 3
        total_queries = prompt_count * 4 * runs_per_prompt  # 4 models
        # ~8 effective concurrent queries, ~3s each
        est_minutes = (total_queries / 8 * 3) / 60
        max_age_minutes = max(15, int(est_minutes * 2))

    cutoff = datetime.now(UTC).replace(tzinfo=None) - timedelta(minutes=max_age_minutes)
    result = await db.execute(
        update(TrackingRun)
        .where(
            TrackingRun.brand_id == brand_id,
            TrackingRun.status.in_(["pending", "running"]),
            TrackingRun.created_at < cutoff,
        )
        .values(status="failed")
    )
    if result.rowcount > 0:
        logger.warning("Auto-failed %d stale run(s) for brand %d (threshold: %d min)", result.rowcount, brand_id, max_age_minutes)
