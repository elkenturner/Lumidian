from datetime import datetime, timezone
from typing import Optional, List
from sqlalchemy import (
    Integer, String, Boolean, Float, ForeignKey, Text,
    Enum as SAEnum, DateTime, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base
import enum


class TierEnum(str, enum.Enum):
    basic = "basic"
    standard = "standard"
    premium = "premium"


class RunStatusEnum(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class RunTypeEnum(str, enum.Enum):
    manual = "manual"
    scheduled = "scheduled"
    prompt = "prompt"  # single-prompt mini run


class ScheduleSlotEnum(str, enum.Enum):
    morning = "morning"
    evening = "evening"


class ModelEnum(str, enum.Enum):
    chatgpt = "chatgpt"
    claude = "claude"
    perplexity = "perplexity"
    gemini = "gemini"


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    google_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, unique=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subscription_tier: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 'starter' | 'pro' | None
    subscription_status: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # 'active' | 'trialing' | 'canceled' | None
    subscription_trial_end: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)  # trial end date (UTC, naive)
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    stripe_subscription_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_paused: Mapped[bool] = mapped_column(Boolean, default=False)  # admin-controlled account pause
    totp_secret: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


# ── System-wide key-value settings ───────────────────────────────────────────

class PasswordResetToken(Base):
    """Short-lived token for password reset flow."""
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SystemSetting(Base):
    """Generic key-value store for system-wide settings (e.g. scheduler_paused)."""
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Brand(Base):
    __tablename__ = "brands"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    tier: Mapped[str] = mapped_column(
        SAEnum(TierEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=TierEnum.basic.value,
    )
    website_url: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    # "standard" | "pitch" — pitch brands expire after 30 days and cap at 10 prompts
    brand_type: Mapped[str] = mapped_column(String(20), nullable=False, default="standard")
    pitch_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    prompts: Mapped[List["Prompt"]] = relationship(
        "Prompt", back_populates="brand", cascade="all, delete-orphan"
    )
    tracking_runs: Mapped[List["TrackingRun"]] = relationship(
        "TrackingRun", back_populates="brand", cascade="all, delete-orphan"
    )
    competitors: Mapped[List["Competitor"]] = relationship(
        "Competitor", back_populates="brand", cascade="all, delete-orphan"
    )
    profile: Mapped[Optional["BrandProfile"]] = relationship(
        "BrandProfile", back_populates="brand", uselist=False, cascade="all, delete-orphan"
    )
    opportunities: Mapped[List["ContentOpportunity"]] = relationship(
        "ContentOpportunity", back_populates="brand", cascade="all, delete-orphan"
    )


class Prompt(Base):
    __tablename__ = "prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Label for display — "standard" | "pitch". Does not change tracking behaviour.
    prompt_type: Mapped[str] = mapped_column(String(20), nullable=False, default="standard")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="prompts")
    query_results: Mapped[List["QueryResult"]] = relationship(
        "QueryResult", back_populates="prompt", cascade="all, delete-orphan"
    )


class TrackingRun(Base):
    __tablename__ = "tracking_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(
        SAEnum(RunStatusEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=RunStatusEnum.pending.value,
    )
    run_type: Mapped[str] = mapped_column(
        SAEnum(RunTypeEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=RunTypeEnum.manual.value,
    )
    schedule_slot: Mapped[Optional[str]] = mapped_column(
        SAEnum(ScheduleSlotEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=True,
    )
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    overall_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    total_queries: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_mentions: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    has_content_influence: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="tracking_runs")
    query_results: Mapped[List["QueryResult"]] = relationship(
        "QueryResult", back_populates="tracking_run", cascade="all, delete-orphan"
    )
    model_scores: Mapped[List["RunModelScore"]] = relationship(
        "RunModelScore", back_populates="tracking_run", cascade="all, delete-orphan"
    )
    content_attributions: Mapped[List["ContentAttribution"]] = relationship(
        "ContentAttribution", back_populates="tracking_run", cascade="all, delete-orphan"
    )


class QueryResult(Base):
    __tablename__ = "query_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id"), nullable=False, index=True
    )
    prompt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("prompts.id"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(
        SAEnum(ModelEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)
    response_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    mentioned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sentiment: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # positive | neutral | negative
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    tracking_run: Mapped["TrackingRun"] = relationship("TrackingRun", back_populates="query_results")
    prompt: Mapped["Prompt"] = relationship("Prompt", back_populates="query_results")


class RunModelScore(Base):
    __tablename__ = "run_model_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(
        SAEnum(ModelEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )
    total_queries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_mentions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    tracking_run: Mapped["TrackingRun"] = relationship("TrackingRun", back_populates="model_scores")


class Competitor(Base):
    __tablename__ = "competitors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    website_url: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="competitors")
    mentions: Mapped[List["CompetitorMention"]] = relationship(
        "CompetitorMention", back_populates="competitor", cascade="all, delete-orphan"
    )


class CompetitorMention(Base):
    """Records whether each competitor was mentioned in each query result."""
    __tablename__ = "competitor_mentions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    competitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("competitors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("prompts.id"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(String(50), nullable=False)
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)
    mentioned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    competitor: Mapped["Competitor"] = relationship("Competitor", back_populates="mentions")
    tracking_run: Mapped["TrackingRun"] = relationship("TrackingRun")
    prompt: Mapped["Prompt"] = relationship("Prompt")


# ── New content / account models ──────────────────────────────────────────────

class AccountConnection(Base):
    __tablename__ = "account_connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    platform: Mapped[str] = mapped_column(String(50), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="disconnected")
    credentials: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    connected_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class BrandContentSettings(Base):
    __tablename__ = "brand_content_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_post: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    brand: Mapped["Brand"] = relationship("Brand")

    __table_args__ = (
        UniqueConstraint("brand_id", "platform", name="uq_brand_content_settings_brand_platform"),
    )


class ContentDraft(Base):
    __tablename__ = "content_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("prompts.id"), nullable=True, index=True
    )
    opportunity_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("content_opportunities.id", ondelete="SET NULL"), nullable=True, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")
    title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    content_brief: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    platform_guidelines_applied: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    visibility_score_at_draft: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    estimated_impact: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # ── Lifecycle tracking ────────────────────────────────────────────────────
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    dismissed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    visibility_at_post: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    edited_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    time_to_approve_seconds: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # 'scheduled' = auto-generated by weekly sweep; 'manual' = user-requested
    source: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    brand: Mapped["Brand"] = relationship("Brand")
    prompt: Mapped[Optional["Prompt"]] = relationship("Prompt")
    content_posts: Mapped[List["ContentPost"]] = relationship(
        "ContentPost", back_populates="draft", cascade="all, delete-orphan"
    )


class ContentPost(Base):
    __tablename__ = "content_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    post_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    platform_post_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    post_metadata: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    draft: Mapped["ContentDraft"] = relationship("ContentDraft", back_populates="content_posts")
    content_attributions: Mapped[List["ContentAttribution"]] = relationship(
        "ContentAttribution", back_populates="content_post", cascade="all, delete-orphan"
    )


class ContentAttribution(Base):
    __tablename__ = "content_attribution"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    content_post_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("prompts.id"), nullable=False, index=True
    )
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id"), nullable=False, index=True
    )
    visibility_before: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    visibility_after: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    improvement_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    measured_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    content_post: Mapped["ContentPost"] = relationship(
        "ContentPost", back_populates="content_attributions"
    )
    tracking_run: Mapped["TrackingRun"] = relationship(
        "TrackingRun", back_populates="content_attributions"
    )
    prompt: Mapped["Prompt"] = relationship("Prompt")
    brand: Mapped["Brand"] = relationship("Brand")


# ── Brand Profile (knowledge base for content drafting) ───────────────────────

class BrandProfile(Base):
    __tablename__ = "brand_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    company_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    key_stats: Mapped[Optional[str]] = mapped_column(Text, nullable=True)        # JSON array of strings
    tone_of_voice: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    what_not_to_say: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON array of strings
    target_audience: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved_language: Mapped[Optional[str]] = mapped_column(Text, nullable=True) # JSON array of strings
    publications: Mapped[Optional[str]] = mapped_column(Text, nullable=True)     # JSON array of {url,title,publisher,date}
    internal_brand_context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # fetched from website via Jina
    website_context_last_fetched: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="profile")


# ── Content Opportunities (Reddit/Quora threads) ──────────────────────────────

class ContentOpportunity(Base):
    __tablename__ = "content_opportunities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False, default="reddit")
    thread_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    thread_title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    subreddit: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    body_preview: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    posted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    relevance_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    prompt_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="new")  # new | drafted | dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="opportunities")
    prompt: Mapped[Optional["Prompt"]] = relationship("Prompt")
    drafts: Mapped[List["ContentDraft"]] = relationship(
        "ContentDraft",
        primaryjoin="ContentOpportunity.id == foreign(ContentDraft.opportunity_id)",
        viewonly=True,
    )


# ── Content Gap Analysis ───────────────────────────────────────────────────────

class ContentGap(Base):
    __tablename__ = "content_gaps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # None = overall
    severity_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    opportunity_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    recency_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    gap_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    competitor_mentions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON dict {name: count}
    platforms_lacking: Mapped[Optional[str]] = mapped_column(Text, nullable=True)    # JSON array
    quora_questions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)      # JSON array [{title, url, snippet}]
    prompt_visibility: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    last_content_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    identified_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand")
    prompt: Mapped["Prompt"] = relationship("Prompt")
    tracking_run: Mapped["TrackingRun"] = relationship("TrackingRun")


# ── Draft Attribution (content performance tracking) ─────────────────────────

class DraftAttribution(Base):
    """Tracks visibility score change for a prompt after a draft is posted."""
    __tablename__ = "content_attributions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    posted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    score_at_posting: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    current_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    delta: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    runs_since_posting: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    draft: Mapped["ContentDraft"] = relationship("ContentDraft")
    brand: Mapped["Brand"] = relationship("Brand")
    prompt: Mapped[Optional["Prompt"]] = relationship("Prompt")


# ── Team Members ──────────────────────────────────────────────────────────────

class TeamMember(Base):
    """Invited team members who get read-only access to an account owner's brands."""
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    account_owner_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invited_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="viewer")
    invite_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    invited_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    account_owner: Mapped["User"] = relationship(
        "User", foreign_keys=[account_owner_id]
    )
    user: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[user_id]
    )


# ── Analytics event log ───────────────────────────────────────────────────────

class AnalyticsEvent(Base):
    """Immutable append-only event log for internal analytics."""
    __tablename__ = "analytics_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    brand_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON blob
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # notification type: "report_ready", "visibility_drop", "draft_ready", "info"
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # optional link target (e.g. /reports, /content)
    link: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
