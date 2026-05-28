from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ── Prompt schemas ────────────────────────────────────────────────────────────

class PromptBase(BaseModel):
    text: str


class PromptCreate(PromptBase):
    # "standard" | "pitch" — display label only, does not change tracking behaviour
    prompt_type: str = "standard"

    @field_validator("prompt_type")
    @classmethod
    def validate_prompt_type(cls, v: str) -> str:
        if v not in ("standard", "pitch"):
            raise ValueError("prompt_type must be 'standard' or 'pitch'")
        return v


class PromptUpdate(BaseModel):
    text: str


class PromptResponse(PromptBase):
    id: int
    brand_id: int
    prompt_type: str = "standard"
    created_at: datetime
    has_history: bool = False

    model_config = {"from_attributes": True}


# ── Brand schemas ─────────────────────────────────────────────────────────────

class BrandCreate(BaseModel):
    name: str
    tier: str = "basic"
    brand_type: str = "standard"  # "standard" | "pitch"
    prompts: list[str] = []
    website_url: str

    @field_validator("website_url")
    @classmethod
    def validate_website_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("website_url is required")
        if not v.startswith(("http://", "https://")):
            v = f"https://{v}"
        return v

    @field_validator("tier")
    @classmethod
    def validate_tier(cls, v: str) -> str:
        allowed = {"basic", "standard", "premium"}
        if v not in allowed:
            raise ValueError(f"tier must be one of {allowed}")
        return v

    @field_validator("brand_type")
    @classmethod
    def validate_brand_type(cls, v: str) -> str:
        if v not in ("standard", "pitch", "pro"):
            raise ValueError("brand_type must be 'standard', 'pitch', or 'pro'")
        return v

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 255:
            raise ValueError("name must be 255 characters or fewer")
        return v

    @field_validator("prompts")
    @classmethod
    def validate_prompts(cls, v: list[str]) -> list[str]:
        if len(v) > 100:
            raise ValueError("Too many prompts (max 100)")
        for i, p in enumerate(v):
            if len(p) > 2000:
                raise ValueError(f"Prompt {i+1} is too long (max 2000 characters)")
        return v


class BrandUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    tier: str | None = None
    website_url: str | None = Field(None, max_length=2000)

    @field_validator("tier")
    @classmethod
    def validate_tier(cls, v: str | None) -> str | None:
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
    brand_type: str = "standard"
    prompt_limit: int = 25
    pitch_expires_at: datetime | None = None
    prompt_count: int
    website_url: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BrandDetail(BaseModel):
    id: int
    name: str
    slug: str
    tier: str
    brand_type: str = "standard"
    prompt_limit: int = 25
    pitch_expires_at: datetime | None = None
    prompt_count: int = 0
    website_url: str | None = None
    created_at: datetime
    updated_at: datetime
    prompts: list[PromptResponse] = []

    model_config = {"from_attributes": True}

    @model_validator(mode="after")
    def _fill_prompt_count(self) -> "BrandDetail":
        if self.prompt_count == 0 and self.prompts:
            self.prompt_count = len(self.prompts)
        return self


# ── TrackingRun schemas ───────────────────────────────────────────────────────

class TrackingRunSummary(BaseModel):
    id: int
    brand_id: int
    status: str
    run_type: str
    schedule_slot: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    overall_score: float | None = None
    total_queries: int | None = None
    total_mentions: int | None = None
    error_message: str | None = None
    has_content_influence: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}


class TrackingRunStatus(BaseModel):
    id: int
    brand_id: int
    status: str
    run_type: str
    schedule_slot: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    overall_score: float | None = None
    total_queries: int | None = None
    total_mentions: int | None = None
    error_message: str | None = None
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
    prompt_text: str | None = None
    model: str
    run_number: int
    response_text: str | None = None
    mentioned: bool
    latency_ms: int | None = None
    error: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedQueryResults(BaseModel):
    total: int
    page: int
    page_size: int
    items: list[QueryResultResponse]


# ── Results / analytics schemas ───────────────────────────────────────────────

class OverviewResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    brand_id: int
    brand_name: str
    brand_tier: str = "basic"
    latest_run: TrackingRunSummary | None = None
    overall_score: float | None = None
    total_queries: int | None = None
    total_mentions: int | None = None
    model_breakdown: list[ModelScoreResponse] = []
    has_content_influence: bool = False
    recent_attributions: list["ContentAttributionSummary"] = []


class TrendPoint(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    run_id: int
    created_at: datetime
    completed_at: datetime | None = None
    overall_score: float | None = None
    total_queries: int | None = None
    total_mentions: int | None = None
    run_type: str
    schedule_slot: str | None = None
    has_content_influence: bool = False
    model_scores: dict[str, float] = {}


class TrendsResponse(BaseModel):
    brand_id: int
    brand_name: str
    trend_data: list[TrendPoint]


# ── Content / attribution schemas ────────────────────────────────────────────

class AccountConnectionSchema(BaseModel):
    id: int
    platform: str
    status: str
    display_name: str | None = None
    connected_at: datetime | None = None
    last_verified_at: datetime | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BrandContentSettingsSchema(BaseModel):
    id: int
    brand_id: int
    platform: str
    enabled: bool
    auto_post: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContentDraftSchema(BaseModel):
    id: int
    brand_id: int
    prompt_id: int | None = None
    opportunity_id: int | None = None
    platform: str
    status: str
    title: str | None = None
    content_text: str
    content_brief: str | None = None
    platform_guidelines_applied: str | None = None
    visibility_score_at_draft: float | None = None
    estimated_impact: float | None = None
    approved_at: datetime | None = None
    dismissed_at: datetime | None = None
    posted_at: datetime | None = None
    visibility_at_post: float | None = None
    source: str | None = "manual"
    edited_count: int = 0
    time_to_approve_seconds: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ContentOpportunitySchema(BaseModel):
    id: int
    brand_id: int
    platform: str
    thread_url: str
    thread_title: str | None = None
    subreddit: str | None = None
    body_preview: str | None = None
    posted_at: datetime | None = None
    relevance_score: float
    prompt_id: int | None = None
    prompt_text: str | None = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentPostSchema(BaseModel):
    id: int
    draft_id: int
    platform: str
    post_url: str | None = None
    platform_post_id: str | None = None
    posted_at: datetime | None = None
    post_metadata: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentAttributionSchema(BaseModel):
    id: int
    content_post_id: int
    tracking_run_id: int
    prompt_id: int
    brand_id: int
    visibility_before: float | None = None
    visibility_after: float | None = None
    improvement_pct: float | None = None
    measured_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class PromptSuggestion(BaseModel):
    prompt_id: int
    text: str
    score: float
    label: str  # "very_relevant" | "somewhat" | "loose"


# ── Request schemas ───────────────────────────────────────────────────────────

class CreateDraftRequest(BaseModel):
    brand_id: int | None = None  # provided via URL path, not required in body
    platform: str = Field(max_length=30)
    prompt_id: int | None = None
    custom_brief: str | None = Field(None, max_length=2000)
    quora_question_url: str | None = Field(None, max_length=500)
    quora_question_title: str | None = Field(None, max_length=300)
    quora_question_snippet: str | None = Field(None, max_length=1000)


class GenerateNowRequest(BaseModel):
    max_gaps: int = Field(20, ge=1, le=50)


class UpdateDraftRequest(BaseModel):
    title: str | None = Field(None, max_length=500)
    content_text: str | None = Field(None, max_length=50_000)
    status: str | None = None
    platform_guidelines_applied: str | None = Field(None, max_length=10_000)
    prompt_id: int | None = Field(None, ge=1)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str | None) -> str | None:
        if v is not None and v not in ("draft", "approved", "posted", "failed"):
            raise ValueError("status must be one of: draft, approved, posted, failed")
        return v


class PostDraftRequest(BaseModel):
    post_url: str | None = Field(None, max_length=2000)
    platform_post_id: str | None = Field(None, max_length=255)


class ConnectAccountRequest(BaseModel):
    platform: str = Field(..., max_length=50)
    credentials: dict

    @field_validator("platform")
    @classmethod
    def validate_platform(cls, v: str) -> str:
        allowed = {"reddit", "quora", "linkedin", "x", "medium", "wikipedia"}
        if v not in allowed:
            raise ValueError(f"platform must be one of {sorted(allowed)}")
        return v


class UpdateContentSettingsRequest(BaseModel):
    auto_post: bool | None = None
    enabled: bool | None = None


# ── Updated overview / trend schemas (include content influence) ──────────────

class ContentAttributionSummary(BaseModel):
    id: int
    content_post_id: int
    tracking_run_id: int
    prompt_id: int
    brand_id: int
    visibility_before: float | None = None
    visibility_after: float | None = None
    improvement_pct: float | None = None
    measured_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Competitor schemas ────────────────────────────────────────────────────────

class CompetitorCreate(BaseModel):
    name: str = Field(..., max_length=255)

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


# ── Competitor analysis schemas ───────────────────────────────────────────────

class CompetitorByModel(BaseModel):
    name: str
    rate: float
    by_model: dict[str, float]


class CompetitorPromptResult(BaseModel):
    prompt_id: int
    prompt_text: str
    brand_rate: float
    brand_by_model: dict[str, float]
    outcome: str  # "win" | "lose" | "tie"
    competitors: list[CompetitorByModel]


class OverallSOV(BaseModel):
    brand_name: str
    brand_pct: float
    competitors: list[dict]  # [{"name": str, "pct": float}]


class CompetitorAnalysisResponse(BaseModel):
    brand_id: int
    brand_name: str
    run_id: int | None
    has_data: bool
    overall: OverallSOV
    prompts: list[CompetitorPromptResult]


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
    score: float | None = None  # 1-10, 1 = mentioned earliest/most prominently
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
    response_text: str | None = None
    created_at: str


class CompetitorStat(BaseModel):
    name: str
    mention_count: int
    mention_rate: float
    is_primary: bool


class ModelStat(BaseModel):
    model: str           # raw model key e.g. "chatgpt"
    label: str           # display name e.g. "ChatGPT"
    mention_count: int
    total: int
    mention_rate: float  # 0–1


class CitationGap(BaseModel):
    domain: str
    domain_type: str
    cited_total: int          # times this domain appears across all responses
    cited_with_brand: int     # subset where brand IS mentioned
    gap_score: float          # fraction of citations that don't mention brand (0–1)
    platform: str | None = None  # supported drafting platform slug if domain maps to one


class DashboardAnalytics(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    brand_id: int
    brand_name: str
    sov: SOVData
    sentiment: SentimentBreakdown
    position: PositionData
    top_domains: list[DomainStat]
    recent_conversations: list[ConversationItem]
    competitor_comparison: list[CompetitorStat]
    model_breakdown: list[ModelStat]
    citation_gaps: list[CitationGap]
    total_responses_analyzed: int
    score_confidence: str = "high"  # "low" (<20 responses), "medium" (20-99), "high" (100+)
    active_models: int = 0  # number of models with successful responses


# ── Competitive Gap ──────────────────────────────────────────────────────────


class CompetitiveGapTrendPoint(BaseModel):
    """Per-day point on the brand-level (aggregate) trend chart."""
    date: str  # ISO YYYY-MM-DD (UTC day)
    gap_pp: float
    brand_pct: float
    comp_avg_pct: float


class CompetitorTrendPoint(BaseModel):
    """Per-day point on a single competitor's trend (drives the table sparkline)."""
    date: str
    gap_pp: float  # brand_pct − competitor_pct that day


class CompetitorGapStat(BaseModel):
    competitor_id: int
    name: str
    competitor_pct: float        # window-aggregate
    gap_pp: float                # window-aggregate brand_pct − competitor_pct
    delta_pp: float | None       # gap now vs prior window of same length
    trend: list[CompetitorTrendPoint]
    has_data: bool               # false if competitor.created_at > window_end


class CompetitiveGapResponse(BaseModel):
    brand_id: int
    window: str                  # "7d" | "30d" | "90d"
    has_competitors: bool
    has_data: bool               # at least one completed run in current window
    headline_gap_pp: float | None
    headline_delta_pp: float | None
    brand_visibility_pct: float | None
    competitor_avg_pct: float | None
    trend: list[CompetitiveGapTrendPoint]
    competitors: list[CompetitorGapStat]
    sample_count: int
    confidence: str              # "low" | "medium" | "high"


# ── Brand Profile schemas ─────────────────────────────────────────────────────

class Publication(BaseModel):
    url: str = ""
    title: str = ""
    publisher: str = ""
    date: str = ""


class BrandProfileUpdate(BaseModel):
    company_description: str | None = Field(None, max_length=5000)
    key_stats: list[str] | None = None
    tone_of_voice: str | None = Field(None, max_length=2000)
    what_not_to_say: list[str] | None = None
    approved_language: list[str] | None = None
    publications: list[Publication] | None = None
    market_scope: str | None = Field(None, max_length=20)
    geography: str | None = Field(None, max_length=200)

    @field_validator("market_scope")
    @classmethod
    def validate_market_scope(cls, v: str | None) -> str | None:
        if v is None:
            return v
        allowed = {"local", "national", "global", "niche"}
        if v not in allowed:
            raise ValueError(f"market_scope must be one of {sorted(allowed)}")
        return v

    @field_validator("key_stats", "what_not_to_say")
    @classmethod
    def validate_list_lengths(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            if len(v) > 50:
                raise ValueError("Maximum 50 items allowed")
            for item in v:
                if len(item) > 1000:
                    raise ValueError("Each item must be 1000 characters or less")
        return v

    @field_validator("approved_language")
    @classmethod
    def validate_approved_language(cls, v: list[str] | None) -> list[str] | None:
        # Approved language often contains full disclaimers/disclosures, which
        # legitimately run longer than terse bullet items. Cap matches company_description.
        if v is not None:
            if len(v) > 50:
                raise ValueError("Maximum 50 items allowed")
            for item in v:
                if len(item) > 5000:
                    raise ValueError("Each item must be 5000 characters or less")
        return v

    @field_validator("publications")
    @classmethod
    def validate_publications_length(cls, v: list[Publication] | None) -> list[Publication] | None:
        if v is not None and len(v) > 50:
            raise ValueError("Maximum 50 publications allowed")
        return v


class BrandProfileResponse(BaseModel):
    id: int
    brand_id: int
    company_description: str | None = None
    key_stats: list[str] = []
    tone_of_voice: str | None = None
    what_not_to_say: list[str] = []
    approved_language: list[str] = []
    publications: list[Publication] = []
    market_scope: str | None = None
    geography: str | None = None
    completion_pct: float = 0.0
    internal_brand_context: str | None = None
    website_context_last_fetched: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class InferScopeResponse(BaseModel):
    market_scope: str
    geography: str | None = None


class AiFillProfileResponse(BaseModel):
    company_description: str | None = None
    tone_of_voice: str | None = None
    key_stats: list[str] = []


# ── Brand with stats (for brand switcher) ─────────────────────────────────────

class BrandWithStats(BaseModel):
    id: int
    name: str
    slug: str
    tier: str
    brand_type: str = "standard"
    prompt_limit: int = 25
    pitch_expires_at: datetime | None = None
    prompt_count: int
    overall_score: float | None = None
    last_run_at: datetime | None = None
    trend: str = "flat"  # "up" | "down" | "flat"
    created_at: datetime
    updated_at: datetime


# ── Content Gap schemas ────────────────────────────────────────────────────────

class ContentGapResponse(BaseModel):
    id: int
    brand_id: int
    prompt_id: int
    prompt_text: str | None = None
    tracking_run_id: int
    model: str | None = None
    severity_score: float
    opportunity_score: float
    recency_score: float
    gap_score: float
    competitor_mentions: dict = {}
    platforms_lacking: list[str] = []
    quora_questions: list[dict] = []
    prompt_visibility: float | None = None
    last_content_at: datetime | None = None
    identified_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Draft Attribution schemas ─────────────────────────────────────────────────

class DraftAttributionResponse(BaseModel):
    id: int
    draft_id: int
    brand_id: int
    prompt_id: int | None = None
    prompt_text: str | None = None
    draft_title: str | None = None
    draft_platform: str | None = None
    posted_at: datetime
    score_at_posting: float | None = None
    current_score: float | None = None
    delta: float | None = None
    runs_since_posting: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Team Member schemas ────────────────────────────────────────────────────────

class TeamMemberResponse(BaseModel):
    id: int
    invited_email: str
    user_id: int | None = None
    role: str
    accepted: bool
    invited_at: datetime
    accepted_at: datetime | None = None

    model_config = {"from_attributes": True}


class InviteTeamMemberRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not v or "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email address")
        if len(v) > 255:
            raise ValueError("Email too long")
        return v


# ── Health ────────────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: datetime


# ── Onboarding ────────────────────────────────────────────────────────────────

class FetchWebsiteContextRequest(BaseModel):
    url: str = Field(..., max_length=2000)
    brand_name: str = ""

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("URL is required")
        if not v.startswith(("http://", "https://")):
            v = f"https://{v}"
        return v


class FetchWebsiteContextResponse(BaseModel):
    context: str
    description: str | None = None


# ── Prompt Intelligence schemas ──────────────────────────────────────────────

class PromptTimelinePoint(BaseModel):
    run_id: int
    completed_at: datetime | None
    scores: dict[str, float]
    overall: float

class ContentEventResponse(BaseModel):
    id: int
    event_type: str
    created_at: datetime
    data: dict | None = None

    model_config = ConfigDict(from_attributes=True)

class PromptTimelineResponse(BaseModel):
    prompt_id: int
    prompt_text: str
    timeline: list[PromptTimelinePoint]
    content_events: list[ContentEventResponse]
    current_scores: dict[str, float]
    total_drafts_targeting: int
    latest_draft_posted_at: datetime | None

class PromptDraftSnapshot(BaseModel):
    id: int
    platform: str
    status: str
    posted_at: datetime | None
    visibility_at_post: float | None
    content_preview: str
    score_snapshot: dict

class PromptCompetitorSummary(BaseModel):
    name: str
    mention_rate: float
    trend: str

class PromptInsight(BaseModel):
    id: str
    message: str
    severity: str
    model: str | None = None

class PromptRecentResponse(BaseModel):
    model: str
    response_text: str | None
    mentioned: bool
    sentiment: str | None
    created_at: datetime

class PromptDetailResponse(BaseModel):
    prompt_id: int
    prompt_text: str
    prompt_type: str
    current_scores: dict[str, float]
    score_trend: str
    timeline: list[PromptTimelinePoint]
    content_events: list[ContentEventResponse]
    drafts: list[PromptDraftSnapshot]
    competitors: list[PromptCompetitorSummary]
    insights: list[PromptInsight]
    recent_responses: list[PromptRecentResponse]

class PromptOverviewItem(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    prompt_id: int
    prompt_text: str
    current_overall: float
    trend: str
    sparkline: list[float]
    model_scores: dict[str, float]
    drafts_posted: int
    last_draft_at: datetime | None
    has_recent_content_event: bool

class PromptsOverviewResponse(BaseModel):
    prompts: list[PromptOverviewItem]


# ── Agency portal ────────────────────────────────────────────────────────────


class AgencyClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    status: str | None = None
    retainer_amount_usd: int | None = None
    primary_contact_name: str | None = None
    primary_contact_email: str | None = None


class AgencyClientUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    status: str | None = None
    retainer_amount_usd: int | None = None
    retainer_started_at: datetime | None = None
    primary_contact_name: str | None = None
    primary_contact_email: str | None = None


class ClientProposalUpdateIn(BaseModel):
    current_proposal_doc_url: str | None = Field(default=None, max_length=500)
    current_proposal_label: str | None = Field(default=None, max_length=200)


class ClientPortalBrandOut(BaseModel):
    id: int
    name: str
    slug: str
    brand_type: str
    website_url: str | None = None


class ClientPortalProposalOut(BaseModel):
    doc_url: str | None = None
    label: str | None = None


class AgencyClientOut(BaseModel):
    id: int
    name: str
    slug: str
    status: str
    retainer_amount_usd: int | None = None
    retainer_started_at: datetime | None = None
    primary_contact_name: str | None = None
    primary_contact_email: str | None = None
    brand_id: int | None = None
    drafts_pending: int = 0
    created_at: datetime
    current_proposal_doc_url: str | None = None
    current_proposal_label: str | None = None

    model_config = ConfigDict(from_attributes=True)


MILESTONE_KINDS = (
    "kickoff",
    "sow",
    "initial_audit",
    "strategy_locked",
    "wikipedia_plan",
    "site_plan",
)
MILESTONE_STATUSES = ("not_started", "in_progress", "done", "skipped")


class AgencyClientMilestoneOut(BaseModel):
    id: int
    agency_client_id: int
    kind: str
    status: str
    started_at: datetime | None = None
    target_at: datetime | None = None
    completed_at: datetime | None = None
    completed_by: int | None = None
    completed_by_name: str | None = None
    notes: str | None = None

    model_config = ConfigDict(from_attributes=True)


class AgencyClientMilestoneUpdate(BaseModel):
    status: str | None = None
    started_at: datetime | None = None
    target_at: datetime | None = None
    notes: str | None = None


# ── Agency portal shell (2026-05-11) ─────────────────────────────────────────


class ReviewLinkOut(BaseModel):
    token: str
    url: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ReviewDraftOut(BaseModel):
    id: int
    title: str | None
    platform: str
    content_text: str
    created_at: datetime


class ReviewClientPageOut(BaseModel):
    client_name: str
    drafts: list[ReviewDraftOut]


class PublicDocumentSummaryOut(BaseModel):
    id: int
    kind: str
    title: str
    generated_at: datetime
    pdf_available: bool

    model_config = ConfigDict(from_attributes=True)


class ChangesRequestIn(BaseModel):
    feedback: str = Field(min_length=1, max_length=2000)


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class DraftStatusUpdateIn(BaseModel):
    status: str = Field(min_length=1, max_length=32)


# ── Website AIO ──────────────────────────────────────────────────────────────

class WebsiteAuditSummary(BaseModel):
    id: int
    brand_id: int
    status: str
    started_at: datetime
    completed_at: datetime | None
    total_pages: int
    pages_failed: int
    overall_score: float | None
    bot_access_score: float | None
    content_score: float | None
    schema_score: float | None
    technical_score: float | None
    render_mode: str | None
    llms_txt_present: bool
    llms_txt_valid: bool
    robots_txt_raw: str | None
    error_message: str | None
    cms_platform: str | None = None


class WebsiteAuditPageOut(BaseModel):
    id: int
    audit_id: int
    url: str
    page_type: str
    http_status: int | None
    title: str | None
    h1_text: str | None
    word_count: int
    fact_density: float
    is_js_rendered: bool
    page_score: float | None
    content_score: float | None
    structure_score: float | None
    schema_score: float | None
    schema_types: list[str] = []


class WebsiteAuditFindingOut(BaseModel):
    id: int
    audit_id: int
    page_id: int | None
    check_id: str
    severity: str
    category: str
    message: str
    evidence: dict | None


class WebsiteAuditRecommendationOut(BaseModel):
    id: int
    audit_id: int
    page_id: int | None
    priority: str
    effort: str
    category: str
    title: str
    body: str
    linked_prompt_ids: list[int] = []
    expected_impact: str | None
    llm_generated: bool
    artifact: str | None = None
    artifact_type: str | None = None
    artifact_generated_at: datetime | None = None
    artifact_regen_count: int = 0
    status: str = "pending"
    expected_lift_pp: float | None = None
    target_url: str | None = None
    priority_score: float | None = None


class CitationSourceOut(BaseModel):
    id: int
    brand_id: int
    prompt_id: int | None
    model: str
    url: str
    domain: str
    kind: str
    competitor_id: int | None
    extracted_at: datetime


class CitationDomainAgg(BaseModel):
    domain: str
    kind: str
    count: int


class TriggerAuditOut(BaseModel):
    audit_id: int
    status: str


# ── Agency activity log (2026-05-12) ─────────────────────────────────────────


class ActivityEventOut(BaseModel):
    id: int
    agency_client_id: int
    event_type: str
    actor_user_id: int | None
    actor_name: str | None
    body: str
    payload: dict | None
    related_draft_id: int | None
    created_at: datetime
    updated_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class NoteCreate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class NoteUpdate(BaseModel):
    body: str = Field(min_length=1, max_length=10000)


class AgencyStaffOut(BaseModel):
    id: int
    name: str | None
    email: str

    model_config = ConfigDict(from_attributes=True)


class ClientStaffAssignmentOut(BaseModel):
    user_id: int
    name: str | None
    email: str
    assigned_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Agency documents (sub-project C, 2026-05-12) ─────────────────────────────


class DocumentTemplateOut(BaseModel):
    kind: str
    name: str
    description: str


class DocumentOut(BaseModel):
    id: int
    agency_client_id: int
    kind: str
    title: str
    body_markdown: str
    generated_by_user_id: int | None
    generated_by_name: str | None
    generated_at: datetime
    updated_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class DocumentGenerateIn(BaseModel):
    kind: str = Field(min_length=1, max_length=64)


class DocumentUpdateIn(BaseModel):
    body_markdown: str = Field(min_length=1, max_length=200000)


# ── BrandSource ─────────────────────────────────────────────────────────────

class BrandSourceCreate(BaseModel):
    url: str = Field(..., max_length=1000)
    title: str | None = Field(None, max_length=500)
    snippet: str | None = Field(None, max_length=1500)
    source_type: Literal["paper", "article", "stat", "case_study"] = "article"


class BrandSourceOut(BaseModel):
    id: int
    title: str
    url: str
    snippet: str | None
    source_type: str
    added_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Voice samples ───────────────────────────────────────────────────────────

class VoiceSampleCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    text: str = Field(..., min_length=50, max_length=4000)


class VoiceSampleOut(BaseModel):
    index: int
    title: str
    text: str


class DraftArtifactRequest(BaseModel):
    regenerate_notes: str | None = None


class DraftArtifactResponse(BaseModel):
    artifact: str
    artifact_type: str
    generated_at: datetime
    regen_count: int


class UpdateRecStatusRequest(BaseModel):
    status: str  # 'pending' | 'applied' | 'dismissed'


# ── Content Clusters ────────────────────────────────────────────────────────

class ContentBriefSchema(BaseModel):
    id: int
    cluster_id: int
    version: int
    positioning: str
    key_claims: list[str]
    canonical_phrasings: list[str]
    stats: list[dict]
    competitor_context: dict
    narrative_spine: str
    tone_notes: str
    created_by: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ClusterPieceSummary(BaseModel):
    platform: str
    draft_id: int | None
    status: str  # draft / approved / posted / failed / missing
    title: str | None
    excerpt: str | None  # first 140 chars of content_text


class ContentClusterSummary(BaseModel):
    """Compact representation for the cluster list view."""
    id: int
    brand_id: int
    prompt_id: int
    prompt_text: str
    status: str
    pillar_mode: str
    pillar_url: str | None
    visibility_pct: float
    pieces: list[ClusterPieceSummary]
    version: int
    last_generated_at: datetime | None
    # New: cluster-effect signal aggregated from DraftAttribution rows
    cluster_delta: float | None  # sum of delta across posted pieces with attribution; None if no posted attribution data
    posted_count: int  # count of pieces with status='posted' in this cluster

    model_config = ConfigDict(from_attributes=True)


class ContentDraftCitationSchema(BaseModel):
    source_ref: str
    url: str
    title: str | None
    position_marker: int | None

    model_config = ConfigDict(from_attributes=True)


class ContentClusterDraft(BaseModel):
    """ContentDraftSchema + per-draft citations + new redesign fields."""
    id: int
    brand_id: int
    prompt_id: int | None
    cluster_id: int | None
    platform: str
    status: str
    title: str | None
    content_text: str
    quality_score: float | None = None
    posted_at: datetime | None = None
    generation_state: str = "done"
    failure_reason: str | None = None
    citations: list[ContentDraftCitationSchema] = []
    # Per-piece attribution lift (DraftAttribution.delta if a row exists)
    attribution_delta: float | None = None

    model_config = ConfigDict(from_attributes=True)


class ContentClusterDetail(BaseModel):
    """Full cluster — brief + drafts with citations."""
    id: int
    brand_id: int
    prompt_id: int
    prompt_text: str
    status: str
    pillar_mode: str
    pillar_url: str | None
    visibility_pct: float
    brief: ContentBriefSchema | None
    drafts: list[ContentClusterDraft]
    version: int
    last_generated_at: datetime | None
    # Mirrors ContentClusterSummary
    cluster_delta: float | None
    posted_count: int

    model_config = ConfigDict(from_attributes=True)


class PillarCandidateSchema(BaseModel):
    page_id: int
    url: str
    title: str | None
    tone_score: float  # 0..1, higher = less promotional
    tone_reasoning: str


class RegeneratePieceRequest(BaseModel):
    platform: str  # must be one of: linkedin, medium, reddit, quora, x


class EditBriefRequest(BaseModel):
    positioning: str | None = None
    key_claims: list[str] | None = None
    canonical_phrasings: list[str] | None = None
    stats: list[dict] | None = None
    narrative_spine: str | None = None
    tone_notes: str | None = None


class ClusterPieceStatus(BaseModel):
    platform: str
    draft_id: int | None = None
    status: str | None = None
    generation_state: str = "done"
    failure_reason: str | None = None


class ClusterStatusPayload(BaseModel):
    status: str
    failure_reason: str | None = None
    pieces: list[ClusterPieceStatus]
    version: int
    last_generated_at: datetime | None = None


class ClusterSourceItem(BaseModel):
    url: str
    domain: str
    tier: str
    title: str | None
    times_cited: int


class ClusterSourcesPayload(BaseModel):
    total_t1: int
    total_t2: int
    total_t3: int
    sources: list[ClusterSourceItem]


# ── Agency drafting (sub-project E, 2026-05-13) ──────────────────────────────


class AgencyDraftGenerateIn(BaseModel):
    prompt_id: int
    platform: str = Field(min_length=1, max_length=64)
    custom_brief: str | None = Field(default=None, max_length=2000)


class MarkPostedIn(BaseModel):
    post_url: str | None = Field(default=None, max_length=1000)


class DraftOut(BaseModel):
    id: int
    brand_id: int
    prompt_id: int | None
    platform: str
    status: str
    title: str | None
    content_text: str | None
    content_brief: str | None
    estimated_impact: str | None
    source: str | None
    assigned_to_user_id: int | None
    posted_at: datetime | None
    created_at: datetime | None
    updated_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


# ── Wikipedia Surface ────────────────────────────────────────────────────────

class WikipediaScanSchema(BaseModel):
    id: int
    brand_id: int
    status: str
    triggered_by: int | None
    prompts_searched: int
    total_candidates_found: int
    candidates_persisted: int
    error_message: str | None
    started_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class WikipediaCandidateSchema(BaseModel):
    id: int
    brand_id: int
    prompt_id: int | None
    scan_id: int
    article_title: str
    article_url: str
    pageid: int
    article_summary: str
    legitimacy_score: float
    legitimacy_reasoning: str
    status: str
    suggested_wikitext: str | None
    suggested_section: str | None
    suggested_insert_location: str | None
    evidence_pack_used: dict | None
    last_drafted_at: datetime | None
    last_status_change_at: datetime | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UpdateCandidateStatusRequest(BaseModel):
    status: str  # 'submitted' | 'accepted' | 'reverted' | 'dismissed'

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        if v not in ("submitted", "accepted", "reverted", "dismissed"):
            raise ValueError("status must be one of submitted/accepted/reverted/dismissed")
        return v


# ── Agency video pipeline ──────────────────────────────────────────────

class VideoChapterOut(BaseModel):
    ts_seconds: int
    label: str


class VideoMetadataJobOut(BaseModel):
    id: int
    agency_client_id: int
    brand_id: int
    status: str
    filename: str
    file_size_bytes: int
    duration_seconds: float | None
    transcript_text: str | None
    transcript_segments: list[dict] | None
    ai_title: str | None
    ai_description: str | None
    ai_chapters: list[VideoChapterOut] | None
    ai_tags: list[str] | None
    ai_jsonld: dict | None
    srt_content: str | None
    vtt_content: str | None
    metadata_failed: bool
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class VideoUploadResponse(BaseModel):
    job_id: int
    status: str


# ── Prospect audits ──────────────────────────────────────────────────────────


class ProspectAuditCreate(BaseModel):
    business_name: str = Field(min_length=1, max_length=200)
    website_url: str = Field(min_length=1, max_length=2048)
    is_local: bool = False
    location: str | None = Field(default=None, max_length=200)

    @model_validator(mode="after")
    def _location_required_when_local(self) -> "ProspectAuditCreate":
        if self.is_local and not (self.location and self.location.strip()):
            raise ValueError("location is required when is_local is true")
        if self.location:
            self.location = self.location.strip()
        return self

    @field_validator("website_url")
    @classmethod
    def _coerce_url(cls, v):
        v = v.strip()
        if not v.startswith(("http://", "https://")):
            v = "https://" + v
        return v


class ProspectAuditListItem(BaseModel):
    id: int
    business_name: str
    website_url: str
    is_local: bool
    location: str | None
    status: str
    overall_visibility_pct: float | None
    aggregate_rvi: float | None
    rvi_band: str | None
    created_at: datetime
    completed_at: datetime | None

    model_config = ConfigDict(from_attributes=True)


class ProspectAuditOut(ProspectAuditListItem):
    status_message: str | None
    error_message: str | None
    cancel_requested: bool
    started_at: datetime | None
    has_pdf: bool

    model_config = ConfigDict(from_attributes=True)
