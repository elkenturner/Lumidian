import logging
import os
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
    ]
    async with engine.begin() as conn:
        for stmt in migrations:
            try:
                await conn.execute(text(stmt))
                logger.info("Migration applied: %s", stmt)
            except Exception:
                # Column/index already exists — safe to ignore
                pass
