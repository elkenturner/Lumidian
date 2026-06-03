import enum
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


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
    onboarding = "onboarding"  # first run — triggers onboarding post-process pipeline


class ScheduleSlotEnum(str, enum.Enum):
    morning = "morning"
    evening = "evening"
    weekly = "weekly"  # agency weekly sweep (scheduler._run_agency_brand_and_report)


class ModelEnum(str, enum.Enum):
    chatgpt = "chatgpt"
    claude = "claude"
    perplexity = "perplexity"
    gemini = "gemini"


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    google_id: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    subscription_tier: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 'starter' | 'pro' | None
    subscription_status: Mapped[str | None] = mapped_column(String(50), nullable=True)  # 'active' | 'trialing' | 'canceled' | None
    subscription_trial_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # trial end date (UTC, naive)
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_paused: Mapped[bool] = mapped_column(Boolean, default=False)  # admin-controlled account pause
    admin_tier_override: Mapped[bool] = mapped_column(Boolean, default=False)  # prevents Stripe webhook from reverting admin tier edits
    pending_tier: Mapped[str | None] = mapped_column(String(50), nullable=True)
    pending_tier_effective_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    stripe_schedule_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    totp_secret: Mapped[str | None] = mapped_column(String(64), nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default='1')
    email_verification_code: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_verification_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    is_agency_staff: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


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
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    tier: Mapped[str] = mapped_column(
        SAEnum(TierEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
        default=TierEnum.basic.value,
    )
    website_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    # "standard" | "pitch" — pitch brands expire after 30 days and cap at 10 prompts
    brand_type: Mapped[str] = mapped_column(String(20), nullable=False, default="standard")
    pitch_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    prompt_limit: Mapped[int] = mapped_column(Integer, default=25)
    last_manual_draft_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    agency_client_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    prompts: Mapped[list["Prompt"]] = relationship(
        "Prompt", back_populates="brand", cascade="all, delete-orphan"
    )
    tracking_runs: Mapped[list["TrackingRun"]] = relationship(
        "TrackingRun", back_populates="brand", cascade="all, delete-orphan"
    )
    competitors: Mapped[list["Competitor"]] = relationship(
        "Competitor", back_populates="brand", cascade="all, delete-orphan"
    )
    profile: Mapped[Optional["BrandProfile"]] = relationship(
        "BrandProfile", back_populates="brand", uselist=False, cascade="all, delete-orphan"
    )
    opportunities: Mapped[list["ContentOpportunity"]] = relationship(
        "ContentOpportunity", back_populates="brand", cascade="all, delete-orphan"
    )


class Prompt(Base):
    __tablename__ = "prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Label for display — "standard" | "pitch". Does not change tracking behaviour.
    prompt_type: Mapped[str] = mapped_column(String(20), nullable=False, default="standard")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="prompts")
    query_results: Mapped[list["QueryResult"]] = relationship(
        "QueryResult", back_populates="prompt", cascade="all, delete-orphan"
    )


class TrackingRun(Base):
    __tablename__ = "tracking_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
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
    schedule_slot: Mapped[str | None] = mapped_column(
        SAEnum(ScheduleSlotEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=True,
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    total_queries: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_mentions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_content_influence: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="tracking_runs")
    query_results: Mapped[list["QueryResult"]] = relationship(
        "QueryResult", back_populates="tracking_run", cascade="all, delete-orphan"
    )
    model_scores: Mapped[list["RunModelScore"]] = relationship(
        "RunModelScore", back_populates="tracking_run", cascade="all, delete-orphan"
    )
    content_attributions: Mapped[list["ContentAttribution"]] = relationship(
        "ContentAttribution", back_populates="tracking_run", cascade="all, delete-orphan"
    )


class QueryResult(Base):
    __tablename__ = "query_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(
        SAEnum(ModelEnum, values_callable=lambda obj: [e.value for e in obj]),
        nullable=False,
    )
    run_number: Mapped[int] = mapped_column(Integer, nullable=False)
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    mentioned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sentiment: Mapped[str | None] = mapped_column(String(20), nullable=True)  # positive | neutral | negative
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Structured citations from web-grounded models (Perplexity citations array,
    # Gemini grounding_metadata). Each entry is `{"url": str, "title": str|None}`.
    # Used by the cluster evidence pipeline as a high-quality source pool.
    citations: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    tracking_run: Mapped["TrackingRun"] = relationship("TrackingRun", back_populates="query_results")
    prompt: Mapped["Prompt"] = relationship("Prompt", back_populates="query_results")


class RunModelScore(Base):
    __tablename__ = "run_model_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=False, index=True
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
    website_url: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="competitors")
    mentions: Mapped[list["CompetitorMention"]] = relationship(
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
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
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
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="disconnected")
    credentials: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    connected_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "platform", name="uq_account_connection_user_platform"),
    )


class BrandContentSettings(Base):
    __tablename__ = "brand_content_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_post: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    drafting_frequency: Mapped[str] = mapped_column(String(50), nullable=False, default="weekly")
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
    prompt_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("prompts.id"), nullable=True, index=True
    )
    opportunity_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("content_opportunities.id", ondelete="SET NULL"), nullable=True, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="draft")
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content_text: Mapped[str] = mapped_column(Text, nullable=False)
    content_brief: Mapped[str | None] = mapped_column(Text, nullable=True)
    platform_guidelines_applied: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility_score_at_draft: Mapped[float | None] = mapped_column(Float, nullable=True)
    estimated_impact: Mapped[float | None] = mapped_column(Float, nullable=True)
    quality_score: Mapped[float | None] = mapped_column(Float)
    summary: Mapped[str | None] = mapped_column(Text)
    # ── Lifecycle tracking ────────────────────────────────────────────────────
    approved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    dismissed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    visibility_at_post: Mapped[float | None] = mapped_column(Float, nullable=True)
    edited_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    time_to_approve_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 'scheduled' = auto-generated by weekly sweep; 'manual' = user-requested
    source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    assigned_to_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    client_feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    # ── Content Clusters FK (nullable; set NULL on cluster delete) ───────────
    cluster_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("content_clusters.id", ondelete="SET NULL"), nullable=True, index=True
    )
    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    generation_state: Mapped[str] = mapped_column(String(20), nullable=False, default="done")

    brand: Mapped["Brand"] = relationship("Brand")
    prompt: Mapped[Optional["Prompt"]] = relationship("Prompt")
    content_posts: Mapped[list["ContentPost"]] = relationship(
        "ContentPost", back_populates="draft", cascade="all, delete-orphan"
    )


# ── Content Clusters & Briefs ─────────────────────────────────────────────────

class ContentCluster(Base):
    """One cluster per prompt — tracks the content strategy state for that query."""
    __tablename__ = "content_clusters"
    __table_args__ = (UniqueConstraint("prompt_id", name="uq_content_clusters_prompt_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    prompt_id: Mapped[int] = mapped_column(Integer, ForeignKey("prompts.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(32), default="pending")
    pillar_mode: Mapped[str] = mapped_column(String(32), default="none")
    pillar_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    # Deferred FK to content_briefs — table created after; use_alter avoids DDL ordering issues
    last_brief_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("content_briefs.id", ondelete="SET NULL", use_alter=True, name="fk_content_clusters_last_brief_id"),
        nullable=True,
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    last_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ContentBrief(Base):
    """Structured brief for a content cluster — describes positioning, claims, and narrative."""
    __tablename__ = "content_briefs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    cluster_id: Mapped[int] = mapped_column(Integer, ForeignKey("content_clusters.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    positioning: Mapped[str] = mapped_column(Text, default="")
    key_claims: Mapped[list] = mapped_column(JSON, default=list)
    canonical_phrasings: Mapped[list] = mapped_column(JSON, default=list)
    stats: Mapped[list] = mapped_column(JSON, default=list)
    competitor_context: Mapped[dict] = mapped_column(JSON, default=dict)
    narrative_spine: Mapped[str] = mapped_column(Text, default="")
    tone_notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    evidence_pack_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("content_evidence_packs.id", ondelete="SET NULL", use_alter=True,
                   name="fk_content_briefs_evidence_pack_id"),
        nullable=True,
    )


class ContentEvidencePack(Base):
    """A cluster-level evidence pack, versioned alongside ContentBrief."""
    __tablename__ = "content_evidence_packs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    cluster_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_clusters.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    sources: Mapped[list] = mapped_column(JSON, default=list)
    total_t1: Mapped[int] = mapped_column(Integer, default=0)
    total_t2: Mapped[int] = mapped_column(Integer, default=0)
    total_t3: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ContentClusterSource(Base):
    """Dedup'd source spine for a cluster — one row per unique URL per cluster."""
    __tablename__ = "content_cluster_sources"
    __table_args__ = (
        UniqueConstraint("cluster_id", "url", name="uq_cluster_source_cluster_url"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    cluster_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_clusters.id", ondelete="CASCADE"), index=True
    )
    evidence_pack_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_evidence_packs.id", ondelete="CASCADE")
    )
    url: Mapped[str] = mapped_column(String(2048))
    domain: Mapped[str] = mapped_column(String(255), index=True)
    tier: Mapped[str] = mapped_column(String(2))  # "T1"/"T2"/"T3"
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    times_cited: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ContentPost(Base):
    __tablename__ = "content_posts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False)
    post_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    platform_post_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    post_metadata: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    draft: Mapped["ContentDraft"] = relationship("ContentDraft", back_populates="content_posts")
    content_attributions: Mapped[list["ContentAttribution"]] = relationship(
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
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    visibility_before: Mapped[float | None] = mapped_column(Float, nullable=True)
    visibility_after: Mapped[float | None] = mapped_column(Float, nullable=True)
    improvement_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
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
    company_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_stats: Mapped[str | None] = mapped_column(Text, nullable=True)        # JSON array of strings
    tone_of_voice: Mapped[str | None] = mapped_column(Text, nullable=True)
    what_not_to_say: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON array of strings
    target_audience: Mapped[str | None] = mapped_column(Text, nullable=True)
    approved_language: Mapped[str | None] = mapped_column(Text, nullable=True) # JSON array of strings
    publications: Mapped[str | None] = mapped_column(Text, nullable=True)     # JSON array of {url,title,publisher,date}
    voice_samples: Mapped[str | None] = mapped_column(Text)  # JSON: list[{"title": str, "text": str}]
    internal_brand_context: Mapped[str | None] = mapped_column(Text, nullable=True)  # fetched from website via Jina
    website_context_last_fetched: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    market_scope: Mapped[str | None] = mapped_column(String(20), nullable=True)
    geography: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="profile")


# ── Content Opportunities (Reddit/Quora/LinkedIn/X threads) ────────────────────

class ContentOpportunity(Base):
    __tablename__ = "content_opportunities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    platform: Mapped[str] = mapped_column(String(50), nullable=False, default="reddit")
    thread_url: Mapped[str] = mapped_column(String(1000), nullable=False)
    thread_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    subreddit: Mapped[str | None] = mapped_column(String(100), nullable=True)
    body_preview: Mapped[str | None] = mapped_column(Text, nullable=True)
    posted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    relevance_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    prompt_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="new")  # new | drafted | dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand", back_populates="opportunities")
    prompt: Mapped[Optional["Prompt"]] = relationship("Prompt")
    drafts: Mapped[list["ContentDraft"]] = relationship(
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
    model: Mapped[str | None] = mapped_column(String(50), nullable=True)  # None = overall
    severity_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    opportunity_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    recency_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    gap_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    competitor_mentions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON dict {name: count}
    platforms_lacking: Mapped[str | None] = mapped_column(Text, nullable=True)    # JSON array
    quora_questions: Mapped[str | None] = mapped_column(Text, nullable=True)      # JSON array [{title, url, snippet}]
    prompt_visibility: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_content_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    identified_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    brand: Mapped["Brand"] = relationship("Brand")
    prompt: Mapped["Prompt"] = relationship("Prompt")
    tracking_run: Mapped["TrackingRun"] = relationship("TrackingRun")


# ── Draft Attribution (content performance tracking) ─────────────────────────

class DraftAttribution(Base):
    """Tracks visibility score change for a prompt after a draft is posted."""
    __tablename__ = "draft_attributions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    draft_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("content_drafts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    posted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    score_at_posting: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    delta: Mapped[float | None] = mapped_column(Float, nullable=True)
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
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="viewer")
    invite_token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    invited_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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
    brand_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON blob
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# ── Prompt-level time-series scores ──────────────────────────────────────────

class PromptRunScore(Base):
    """Per-prompt per-model visibility score snapshot for each tracking run."""
    __tablename__ = "prompt_run_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    prompt_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    tracking_run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    model: Mapped[str] = mapped_column(String(50), nullable=False)
    score: Mapped[float] = mapped_column(Float, nullable=False)
    mentioned_count: Mapped[int] = mapped_column(Integer, nullable=False)
    query_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("prompt_id", "tracking_run_id", "model", name="uq_prompt_run_score"),
    )


# ── Content event log (silent storage for future intelligence) ───────────────

class ContentEvent(Base):
    """Flexible event log for content-related signals. JSON data column for arbitrary payloads."""
    __tablename__ = "content_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    prompt_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    data: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON blob
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class ProcessedWebhookEvent(Base):
    """Tracks Stripe webhook event IDs to prevent duplicate processing on retries."""
    __tablename__ = "processed_webhook_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    stripe_event_id: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    processed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # notification type: "report_ready", "visibility_drop", "draft_ready", "info"
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    # optional link target (e.g. /reports, /content)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


# ── Agency portal ────────────────────────────────────────────────────────────


class AgencyClientStatusEnum(str, enum.Enum):
    onboarding = "onboarding"
    active = "active"
    paused = "paused"
    churned = "churned"


class AgencyClient(Base):
    __tablename__ = "agency_clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="onboarding")
    retainer_amount_usd: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retainer_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    primary_contact_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    primary_contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    current_proposal_doc_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_proposal_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class AgencyStaff(Base):
    __tablename__ = "agency_staff"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="contractor")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AgencyClientAssignment(Base):
    """Links an agency staff user to a specific AgencyClient.

    Non-admin staff can only access clients they're assigned to via this table.
    Admins bypass the check entirely. Auto-populated on client create with
    the creator's user_id.
    """
    __tablename__ = "agency_client_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    staff_user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assigned_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("agency_client_id", "staff_user_id", name="uq_client_staff_assignment"),
    )


class AgencyClientMilestone(Base):
    __tablename__ = "agency_client_milestones"
    __table_args__ = (
        UniqueConstraint("agency_client_id", "kind", name="uq_agency_client_milestones_client_kind"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="not_started")
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    target_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class ClientReviewLink(Base):
    __tablename__ = "client_review_links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class VideoMetadataJobStatusEnum(str, enum.Enum):
    uploaded = "uploaded"
    transcribing = "transcribing"
    generating = "generating"
    completed = "completed"
    failed = "failed"


class VideoMetadataJob(Base):
    __tablename__ = "video_metadata_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    brand_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="uploaded", index=True)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    transcript_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    transcript_segments: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    ai_title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    ai_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_chapters: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ai_tags: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ai_jsonld: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    srt_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    vtt_content: Mapped[str | None] = mapped_column(Text, nullable=True)

    metadata_failed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ── Website AIO module ───────────────────────────────────────────────────────

class WebsiteAudit(Base):
    __tablename__ = "website_audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    triggered_by: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    total_pages: Mapped[int] = mapped_column(Integer, default=0)
    pages_failed: Mapped[int] = mapped_column(Integer, default=0)
    overall_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    bot_access_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    content_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    schema_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    technical_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    render_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    sitemap_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    robots_txt_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    llms_txt_present: Mapped[bool] = mapped_column(Boolean, default=False)
    llms_txt_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    cms_platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class WebsiteAuditPage(Base):
    __tablename__ = "website_audit_pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    audit_id: Mapped[int] = mapped_column(Integer, ForeignKey("website_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)
    depth: Mapped[int] = mapped_column(Integer, default=0)
    http_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fetch_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    page_type: Mapped[str] = mapped_column(String(20), default="other")
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[str | None] = mapped_column(String(512), nullable=True)
    meta_description: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    h1_text: Mapped[str | None] = mapped_column(String(512), nullable=True)
    h2_count: Mapped[int] = mapped_column(Integer, default=0)
    h3_count: Mapped[int] = mapped_column(Integer, default=0)
    table_count: Mapped[int] = mapped_column(Integer, default=0)
    list_count: Mapped[int] = mapped_column(Integer, default=0)
    fact_density: Mapped[float] = mapped_column(Float, default=0.0)
    outbound_links: Mapped[int] = mapped_column(Integer, default=0)
    internal_links: Mapped[int] = mapped_column(Integer, default=0)
    image_count: Mapped[int] = mapped_column(Integer, default=0)
    image_alt_pct: Mapped[float] = mapped_column(Float, default=0.0)
    has_jsonld: Mapped[bool] = mapped_column(Boolean, default=False)
    schema_types: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_js_rendered: Mapped[bool] = mapped_column(Boolean, default=False)
    page_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    content_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    structure_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    schema_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_html_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    rendered_html_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    content_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetch_error: Mapped[str | None] = mapped_column(String(255), nullable=True)


class WebsiteAuditFinding(Base):
    __tablename__ = "website_audit_findings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    audit_id: Mapped[int] = mapped_column(Integer, ForeignKey("website_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    page_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("website_audit_pages.id", ondelete="CASCADE"), nullable=True, index=True)
    check_id: Mapped[str] = mapped_column(String(64), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class WebsiteAuditRecommendation(Base):
    __tablename__ = "website_audit_recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    audit_id: Mapped[int] = mapped_column(Integer, ForeignKey("website_audits.id", ondelete="CASCADE"), nullable=False, index=True)
    page_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("website_audit_pages.id", ondelete="CASCADE"), nullable=True, index=True)
    priority: Mapped[str] = mapped_column(String(8), nullable=False)
    effort: Mapped[str] = mapped_column(String(8), nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    linked_prompt_ids: Mapped[str | None] = mapped_column(Text, nullable=True)
    expected_impact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    llm_generated: Mapped[bool] = mapped_column(Boolean, default=False)
    artifact: Mapped[str | None] = mapped_column(Text, nullable=True)
    artifact_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    artifact_generated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    artifact_regen_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    expected_lift_pp: Mapped[float | None] = mapped_column(Float, nullable=True)
    target_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    priority_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class CitationSource(Base):
    __tablename__ = "citation_sources"
    __table_args__ = (
        UniqueConstraint("query_result_id", "url", name="uq_citation_qr_url"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    brand_id: Mapped[int] = mapped_column(Integer, ForeignKey("brands.id", ondelete="CASCADE"), nullable=False, index=True)
    tracking_run_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("tracking_runs.id", ondelete="CASCADE"), nullable=True, index=True)
    prompt_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("prompts.id", ondelete="CASCADE"), nullable=True, index=True)
    query_result_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("query_results.id", ondelete="CASCADE"), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(20), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)
    domain: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    competitor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("competitors.id", ondelete="SET NULL"), nullable=True)
    extracted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, nullable=False)


class ClientActivityEvent(Base):
    __tablename__ = "client_activity_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    actor_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    related_draft_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("content_drafts.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class AgencyTask(Base):
    __tablename__ = "agency_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="open")
    assigned_to_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ClientDocument(Base):
    __tablename__ = "client_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agency_client_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agency_clients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    data_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    generated_by_user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ── Content quality rebuild — evidence retrieval, citations, voice samples ───

class BrandSource(Base):
    __tablename__ = "brand_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(500))
    url: Mapped[str] = mapped_column(String(1000))
    snippet: Mapped[str | None] = mapped_column(Text)
    source_type: Mapped[str] = mapped_column(String(50), default="article")
    added_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    added_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None))


class ContentDraftCitation(Base):
    __tablename__ = "content_draft_citations"

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("content_drafts.id", ondelete="CASCADE"), index=True)
    source_ref: Mapped[str] = mapped_column(String(10))   # "S1"
    url: Mapped[str] = mapped_column(String(1000))
    title: Mapped[str | None] = mapped_column(String(500))
    position_marker: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(UTC).replace(tzinfo=None))


class EvidenceCache(Base):
    __tablename__ = "evidence_cache"

    brand_id: Mapped[int] = mapped_column(primary_key=True)
    prompt_id: Mapped[int] = mapped_column(primary_key=True)
    pack_json: Mapped[str] = mapped_column(Text)
    fetched_at: Mapped[datetime] = mapped_column(DateTime)


class WikipediaScan(Base):
    __tablename__ = "wikipedia_scans"

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="running")
    triggered_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    prompts_searched: Mapped[int] = mapped_column(default=0)
    total_candidates_found: Mapped[int] = mapped_column(default=0)
    candidates_persisted: Mapped[int] = mapped_column(default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC).replace(tzinfo=None))
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class WikipediaCandidate(Base):
    __tablename__ = "wikipedia_candidates"
    __table_args__ = (
        UniqueConstraint("brand_id", "article_title", name="uq_wikipedia_candidates_brand_article"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    brand_id: Mapped[int] = mapped_column(ForeignKey("brands.id", ondelete="CASCADE"), index=True)
    prompt_id: Mapped[int | None] = mapped_column(ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True)
    scan_id: Mapped[int] = mapped_column(ForeignKey("wikipedia_scans.id", ondelete="CASCADE"))
    article_title: Mapped[str] = mapped_column(String(512))
    article_url: Mapped[str] = mapped_column(String(2048))
    pageid: Mapped[int] = mapped_column()
    article_summary: Mapped[str] = mapped_column(Text, default="")
    legitimacy_score: Mapped[float] = mapped_column(default=0.0)
    legitimacy_reasoning: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="new")
    suggested_wikitext: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_section: Mapped[str | None] = mapped_column(String(255), nullable=True)
    suggested_insert_location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    evidence_pack_used: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    last_drafted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_status_change_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC).replace(tzinfo=None))


# ── Prospect audits (agency) ──────────────────────────────────────────────────


class ProspectAudit(Base):
    __tablename__ = "prospect_audits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    staff_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)

    business_name: Mapped[str] = mapped_column(String, nullable=False)
    website_url: Mapped[str] = mapped_column(String, nullable=False)
    is_local: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    location: Mapped[str | None] = mapped_column(String, nullable=True)

    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", index=True)
    status_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    overall_visibility_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    aggregate_rvi: Mapped[float | None] = mapped_column(Float, nullable=True)
    rvi_band: Mapped[str | None] = mapped_column(String, nullable=True)

    pdf_path: Mapped[str | None] = mapped_column(String, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
