import logging
import os
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./clarity_ai.db")

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {},
)

# Enable FK constraints for every new SQLite connection (aiosqlite uses the sync
# driver under the hood, so the sync `connect` event fires reliably).
if "sqlite" in DATABASE_URL:
    from sqlalchemy import text as _text

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
        """UPDATE brands SET user_id = (
            SELECT id FROM users WHERE email = 'ken@lumidian.ai' LIMIT 1
        ) WHERE user_id IS NULL""",
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
        """CREATE TABLE IF NOT EXISTS content_attributions (
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
    ]
    async with engine.begin() as conn:
        for stmt in migrations:
            try:
                await conn.execute(text(stmt))
                logger.info("Migration applied: %s", stmt)
            except Exception:
                # Column/index already exists — safe to ignore
                pass
