from datetime import datetime
from typing import Optional
from pydantic import BaseModel, field_validator


# ── Prompt schemas ────────────────────────────────────────────────────────────

class PromptBase(BaseModel):
    text: str


class PromptCreate(PromptBase):
    pass


class PromptResponse(PromptBase):
    id: int
    brand_id: int
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Brand schemas ─────────────────────────────────────────────────────────────

class BrandCreate(BaseModel):
    name: str
    tier: str = "basic"
    prompts: list[str] = []
    website_url: Optional[str] = None

    @field_validator("tier")
    @classmethod
    def validate_tier(cls, v: str) -> str:
        allowed = {"basic", "standard", "premium"}
        if v not in allowed:
            raise ValueError(f"tier must be one of {allowed}")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        return v


class BrandUpdate(BaseModel):
    name: Optional[str] = None
    tier: Optional[str] = None
    website_url: Optional[str] = None

    @field_validator("tier")
    @classmethod
    def validate_tier(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            allowed = {"basic", "standard", "premium"}
            if v not in allowed:
                raise ValueError(f"tier must be one of {allowed}")
        return v


class BrandSummary(BaseModel):
    id: int
    name: str
    slug: str
    tier: str
    prompt_count: int
    website_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BrandDetail(BaseModel):
    id: int
    name: str
    slug: str
    tier: str
    website_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    prompts: list[PromptResponse] = []

    model_config = {"from_attributes": True}


# ── TrackingRun schemas ───────────────────────────────────────────────────────

class TrackingRunSummary(BaseModel):
    id: int
    brand_id: int
    status: str
    run_type: str
    schedule_slot: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    overall_score: Optional[float] = None
    total_queries: Optional[int] = None
    total_mentions: Optional[int] = None
    error_message: Optional[str] = None
    has_content_influence: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class TrackingRunStatus(BaseModel):
    id: int
    brand_id: int
    status: str
    run_type: str
    schedule_slot: Optional[str] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    overall_score: Optional[float] = None
    total_queries: Optional[int] = None
    total_mentions: Optional[int] = None
    error_message: Optional[str] = None
    has_content_influence: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class ManualRunResponse(BaseModel):
    run_id: int
    brand_id: int
    status: str
    message: str


# ── RunModelScore schemas ─────────────────────────────────────────────────────

class ModelScoreResponse(BaseModel):
    model: str
    total_queries: int
    total_mentions: int
    score: float

    model_config = {"from_attributes": True}


# ── QueryResult schemas ───────────────────────────────────────────────────────

class QueryResultResponse(BaseModel):
    id: int
    tracking_run_id: int
    prompt_id: int
    prompt_text: Optional[str] = None
    model: str
    run_number: int
    response_text: Optional[str] = None
    mentioned: bool
    latency_ms: Optional[int] = None
    error: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedQueryResults(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[QueryResultResponse]


# ── Results / analytics schemas ───────────────────────────────────────────────

class OverviewResponse(BaseModel):
    brand_id: int
    brand_name: str
    brand_tier: str = "basic"
    latest_run: Optional[TrackingRunSummary] = None
    overall_score: Optional[float] = None
    total_queries: Optional[int] = None
    total_mentions: Optional[int] = None
    model_breakdown: list[ModelScoreResponse] = []
    has_content_influence: bool = False
    recent_attributions: list["ContentAttributionSummary"] = []


class TrendPoint(BaseModel):
    run_id: int
    created_at: datetime
    completed_at: Optional[datetime] = None
    overall_score: Optional[float] = None
    total_queries: Optional[int] = None
    total_mentions: Optional[int] = None
    run_type: str
    schedule_slot: Optional[str] = None
    has_content_influence: bool = False


class TrendsResponse(BaseModel):
    brand_id: int
    brand_name: str
    trend_data: list[TrendPoint]


# ── Content / attribution schemas ────────────────────────────────────────────

class AccountConnectionSchema(BaseModel):
    id: int
    platform: str
    status: str
    display_name: Optional[str] = None
    connected_at: Optional[datetime] = None
    last_verified_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BrandContentSettingsSchema(BaseModel):
    id: int
    brand_id: int
    platform: str
    enabled: bool
    drafting_frequency: str
    auto_post: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContentDraftSchema(BaseModel):
    id: int
    brand_id: int
    prompt_id: Optional[int] = None
    opportunity_id: Optional[int] = None
    platform: str
    status: str
    title: Optional[str] = None
    content_text: str
    content_brief: Optional[str] = None
    platform_guidelines_applied: Optional[str] = None
    visibility_score_at_draft: Optional[float] = None
    estimated_impact: Optional[float] = None
    approved_at: Optional[datetime] = None
    dismissed_at: Optional[datetime] = None
    posted_at: Optional[datetime] = None
    edited_count: int = 0
    time_to_approve_seconds: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContentOpportunitySchema(BaseModel):
    id: int
    brand_id: int
    platform: str
    thread_url: str
    thread_title: Optional[str] = None
    subreddit: Optional[str] = None
    body_preview: Optional[str] = None
    posted_at: Optional[datetime] = None
    relevance_score: float
    prompt_id: Optional[int] = None
    prompt_text: Optional[str] = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentPostSchema(BaseModel):
    id: int
    draft_id: int
    platform: str
    post_url: Optional[str] = None
    platform_post_id: Optional[str] = None
    posted_at: Optional[datetime] = None
    post_metadata: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentAttributionSchema(BaseModel):
    id: int
    content_post_id: int
    tracking_run_id: int
    prompt_id: int
    brand_id: int
    visibility_before: Optional[float] = None
    visibility_after: Optional[float] = None
    improvement_pct: Optional[float] = None
    measured_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Request schemas ───────────────────────────────────────────────────────────

class CreateDraftRequest(BaseModel):
    brand_id: int
    platform: str
    prompt_id: Optional[int] = None
    custom_brief: Optional[str] = None


class GenerateNowRequest(BaseModel):
    max_gaps: int = 3


class UpdateDraftRequest(BaseModel):
    title: Optional[str] = None
    content_text: Optional[str] = None
    status: Optional[str] = None
    platform_guidelines_applied: Optional[str] = None


class PostDraftRequest(BaseModel):
    post_url: Optional[str] = None
    platform_post_id: Optional[str] = None


class ConnectAccountRequest(BaseModel):
    platform: str
    credentials: dict


class UpdateContentSettingsRequest(BaseModel):
    drafting_frequency: Optional[str] = None
    auto_post: Optional[bool] = None
    enabled: Optional[bool] = None


# ── Updated overview / trend schemas (include content influence) ──────────────

class ContentAttributionSummary(BaseModel):
    id: int
    content_post_id: int
    tracking_run_id: int
    prompt_id: int
    brand_id: int
    visibility_before: Optional[float] = None
    visibility_after: Optional[float] = None
    improvement_pct: Optional[float] = None
    measured_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Competitor schemas ────────────────────────────────────────────────────────

class CompetitorCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        return v


class CompetitorResponse(BaseModel):
    id: int
    brand_id: int
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Dashboard analytics schemas ───────────────────────────────────────────────

class SOVData(BaseModel):
    percentage: float
    brand_mentions: int
    total_mentions: int
    has_competitors: bool


class SentimentBreakdown(BaseModel):
    positive_pct: float
    neutral_pct: float
    negative_pct: float
    has_data: bool = False


class PositionData(BaseModel):
    score: Optional[float] = None  # 1-10, 1 = mentioned earliest/most prominently
    label: str    # "Early", "Middle", "Late", or "N/A"
    sample_count: int


class DomainStat(BaseModel):
    domain: str
    count: int
    pct: float
    domain_type: str


class ConversationItem(BaseModel):
    id: int
    prompt_text: str
    model: str
    mentioned: bool
    response_preview: str
    response_text: Optional[str] = None
    created_at: str


class CompetitorStat(BaseModel):
    name: str
    mention_count: int
    mention_rate: float
    is_primary: bool


class DashboardAnalytics(BaseModel):
    brand_id: int
    brand_name: str
    sov: SOVData
    sentiment: SentimentBreakdown
    position: PositionData
    top_domains: list[DomainStat]
    recent_conversations: list[ConversationItem]
    competitor_comparison: list[CompetitorStat]
    total_responses_analyzed: int


# ── Brand Profile schemas ─────────────────────────────────────────────────────

class Publication(BaseModel):
    url: str = ""
    title: str = ""
    publisher: str = ""
    date: str = ""


class BrandProfileUpdate(BaseModel):
    company_description: Optional[str] = None
    key_stats: Optional[list[str]] = None
    tone_of_voice: Optional[str] = None
    what_not_to_say: Optional[list[str]] = None
    target_audience: Optional[str] = None
    approved_language: Optional[list[str]] = None
    publications: Optional[list[Publication]] = None


class BrandProfileResponse(BaseModel):
    id: int
    brand_id: int
    company_description: Optional[str] = None
    key_stats: list[str] = []
    tone_of_voice: Optional[str] = None
    what_not_to_say: list[str] = []
    target_audience: Optional[str] = None
    approved_language: list[str] = []
    publications: list[Publication] = []
    completion_pct: float = 0.0
    internal_brand_context: Optional[str] = None
    website_context_last_fetched: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Brand with stats (for brand switcher) ─────────────────────────────────────

class BrandWithStats(BaseModel):
    id: int
    name: str
    slug: str
    tier: str
    prompt_count: int
    overall_score: Optional[float] = None
    last_run_at: Optional[datetime] = None
    trend: str = "flat"  # "up" | "down" | "flat"
    created_at: datetime
    updated_at: datetime


# ── Content Gap schemas ────────────────────────────────────────────────────────

class ContentGapResponse(BaseModel):
    id: int
    brand_id: int
    prompt_id: int
    prompt_text: Optional[str] = None
    tracking_run_id: int
    model: Optional[str] = None
    severity_score: float
    opportunity_score: float
    recency_score: float
    gap_score: float
    competitor_mentions: dict = {}
    platforms_lacking: list[str] = []
    prompt_visibility: Optional[float] = None
    last_content_at: Optional[datetime] = None
    identified_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: datetime
