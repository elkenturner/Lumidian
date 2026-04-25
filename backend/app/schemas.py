from datetime import datetime

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


class PromptResponse(PromptBase):
    id: int
    brand_id: int
    prompt_type: str = "standard"
    created_at: datetime

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
    target_audience: str | None = Field(None, max_length=2000)
    approved_language: list[str] | None = None
    publications: list[Publication] | None = None

    @field_validator("key_stats", "what_not_to_say", "approved_language")
    @classmethod
    def validate_list_lengths(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            if len(v) > 50:
                raise ValueError("Maximum 50 items allowed")
            for item in v:
                if len(item) > 1000:
                    raise ValueError("Each item must be 1000 characters or less")
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
    target_audience: str | None = None
    approved_language: list[str] = []
    publications: list[Publication] = []
    completion_pct: float = 0.0
    internal_brand_context: str | None = None
    website_context_last_fetched: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class AiFillProfileResponse(BaseModel):
    company_description: str | None = None
    target_audience: str | None = None
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
