import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  },
  withCredentials: true,
  timeout: 30_000,
});

// ── Response interceptor: 401 (session) and 403 (paused account) ─────────────
// 401: redirect to /login on session expiry. Skip for /auth/me (AuthContext
//      owns that flow) and /auth/logout (expected to fail when not logged in).
// 403 with detail.code === 'account_paused': redirect to /account-paused.
//      Skip if already on that page (prevents redirect loop) or if the failing
//      request was /auth/logout (so the paused page can still log the user out).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window === 'undefined') return Promise.reject(error);

    const status: number | undefined = error?.response?.status;
    const url: string = error.config?.url ?? '';
    const isAuthMe = url.includes('/auth/me');
    const isAuthLogout = url.includes('/auth/logout');

    if (status === 403) {
      const detail = error?.response?.data?.detail;
      const code = detail && typeof detail === 'object' ? detail.code : null;
      if (
        code === 'account_paused' &&
        !isAuthLogout &&
        window.location.pathname !== '/account-paused'
      ) {
        window.location.href = '/account-paused';
      }
    } else if (status === 401) {
      if (!isAuthMe && !isAuthLogout) {
        // Clear the JS-readable session cookie so middleware stops treating user as logged-in
        document.cookie = 'clarity_session=; path=/; max-age=0';
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  },
);

// ── Error parsing ─────────────────────────────────────────────────────────────
// Extracts the human-readable message from an Axios error response.
// Falls back to the provided default if the server didn't send a detail field.
export function parseApiError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } }; request?: unknown };
  const detail = e?.response?.data?.detail;
  // FastAPI 422 sends `detail` as an array of objects, and some handlers send
  // an object — only trust it when it's a plain string, else fall through to a
  // status-based message. Returning a non-string here crashes React on render.
  if (typeof detail === 'string' && detail) return detail;
  const status = e?.response?.status;
  if (status === 402) return 'Upgrade your plan to use this feature.';
  if (status === 409) return 'This action is already in progress. Please wait for it to finish.';
  if (status === 429) return 'You\'ve hit a usage limit. Please wait or upgrade your plan.';
  if (status === 403) return 'You don\'t have permission to do that.';
  if (status === 404) return 'Not found.';
  // Network error: request was sent but no response received (offline, DNS failure, timeout)
  if (!e?.response && e?.request) return 'Network error — please check your connection and try again.';
  return fallback;
}

// ── Request deduplication + TTL cache ─────────────────────────────────────────
// Two layers:
//   1. _inflight  — deduplicates concurrent requests for the same URL (unchanged)
//   2. _cache     — returns a fresh-enough cached response on repeat navigations
//                   so switching tabs doesn't re-fetch data that's < CACHE_TTL ms old
const CACHE_TTL = 45_000; // 45 seconds

const _inflight = new Map<string, Promise<any>>();
const _cache    = new Map<string, { data: unknown; ts: number }>();

function cacheKey(url: string, params?: Record<string, unknown>): string {
  if (!params) return url;
  const qs = Object.entries(params)
    .filter(([, v]) => v != null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join('&');
  return qs ? `${url}?${qs}` : url;
}

function dedupedGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const key = cacheKey(url, params);

  // Return still-valid cached response immediately
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return Promise.resolve(hit.data as T);

  // Dedup concurrent requests for the same key
  if (_inflight.has(key)) return _inflight.get(key) as Promise<T>;

  const p = api.get<T>(url, params ? { params } : undefined)
    .then((r) => {
      // A string body means the proxy/backend returned HTML (error page,
      // interstitial) with a 200 — our JSON endpoints never do. Treat it as
      // an error so callers hit their catch instead of caching+returning a
      // string that then crashes `.map`/`.find` on it.
      if (typeof r.data === 'string') {
        throw new Error(`Expected JSON from ${url} but received a non-JSON response.`);
      }
      _cache.set(key, { data: r.data, ts: Date.now() });
      return r.data;
    })
    .finally(() => _inflight.delete(key));
  _inflight.set(key, p);
  return p;
}

/** Evict one or more cache entries whose key starts with the given prefix. */
export function invalidateCache(urlPrefix: string): void {
  Array.from(_cache.keys()).forEach((key) => {
    if (key.startsWith(urlPrefix)) _cache.delete(key);
  });
}

export interface Brand {
  id: number;
  name: string;
  slug: string;
  tier: 'basic' | 'standard' | 'premium';
  brand_type: 'standard' | 'pitch' | 'pro';
  prompt_limit: number;
  pitch_expires_at: string | null;
  prompt_count: number;
  website_url?: string | null;
  created_at: string;
}

export interface Prompt {
  id: number;
  brand_id: number;
  text: string;
  prompt_type: 'standard' | 'pitch';
  has_history: boolean;
}

export interface BrandDetail extends Brand {
  prompts: Prompt[];
}

export interface TrackingRun {
  id: number;
  brand_id: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  run_type: string;
  overall_score: number | null;
  total_queries: number;
  total_mentions: number;
  failed_queries?: number | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  has_content_influence?: boolean;
  model_scores?: ModelScore[];
}

export interface ModelScore {
  model: string;
  score: number;
  total_queries: number;
  total_mentions: number;
  error?: string;
}

export interface RunWithModelScores extends TrackingRun {
  model_scores: ModelScore[];
}

export interface TrendPoint {
  run_id: number;
  score: number;
  completed_at: string;
  total_queries: number;
  total_mentions: number;
  model_scores: Record<string, number>;
}

export interface QueryResult {
  id: number;
  prompt_id: number;
  model: string;
  run_number: number;
  prompt_text: string;
  response_text: string;
  mentioned: boolean;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

export interface OverviewData {
  brand_id: number;
  brand_name: string;
  brand_tier: string;
  latest_run: RunWithModelScores | null;
  model_breakdown: ModelScore[];
  recent_runs?: TrackingRun[];
}

export interface PlatformGuidelines {
  tone: string;
  rules: string[];
  disclaimer: string | null;
  workflow: string;
}

export interface BrandContentSettings {
  id: number;
  brand_id: number;
  platform: string;
  enabled: boolean;
  auto_post: boolean;
}

export interface ContentDraft {
  id: number;
  brand_id: number;
  prompt_id: number | null;
  opportunity_id: number | null;
  platform: string;
  status: 'draft' | 'approved' | 'posted' | 'failed';
  title: string | null;
  content_text: string;
  content_brief: string | null;
  // Human label for the routing destination (e.g. the Quora question title,
  // or the Reddit thread title when content_brief is a full thread URL).
  target_title?: string | null;
  platform_guidelines_applied: string | null;
  visibility_score_at_draft: number | null;
  estimated_impact: number | null;
  approved_at: string | null;
  dismissed_at: string | null;
  posted_at: string | null;
  visibility_at_post: number | null;
  source: string | null;
  edited_count: number;
  time_to_approve_seconds: number | null;
  created_at: string;
  updated_at: string;
  prompt_text?: string;
  assigned_to_user_id: number | null;
  cluster_id?: number | null;
  generation_state?: 'queued' | 'writing' | 'critic' | 'rendering' | 'done' | 'failed';
  failure_reason?: string | null;
  citations?: Array<{
    source_ref: string;
    url: string;
    title: string | null;
    position_marker: number | null;
    tier?: 'T1' | 'T2' | 'T3' | null;
  }>;
  attribution_delta?: number | null;
  low_evidence?: boolean;
  posted_url?: string | null;
  brief_version?: number | null;
}

export interface ContentOpportunity {
  id: number;
  brand_id: number;
  platform: string;
  thread_url: string;
  thread_title: string | null;
  subreddit: string | null;
  body_preview: string | null;
  posted_at: string | null;
  relevance_score: number;
  prompt_id: number | null;
  prompt_text: string | null;
  status: 'new' | 'drafted' | 'dismissed';
  created_at: string;
}

export interface ContentAttribution {
  id: number;
  content_post_id: number;
  tracking_run_id: number;
  prompt_id: number;
  brand_id: number;
  visibility_before: number | null;
  visibility_after: number | null;
  improvement_pct: number | null;
  measured_at: string;
  prompt_text?: string;
  platform?: string;
  post_url?: string;
}

export interface ApiKeyStatus {
  openai: boolean;
  anthropic: boolean;
  perplexity: boolean;
  gemini: boolean;
}

// ── Brand / Prompt / Run functions ──────────────────────────────────────────

export async function getBrands(): Promise<Brand[]> {
  return dedupedGet<Brand[]>('/brands');
}

export async function getBrand(id: number): Promise<BrandDetail> {
  return dedupedGet<BrandDetail>(`/brands/${id}`);
}

export async function createBrand(data: {
  name: string;
  tier: string;
  brand_type?: 'standard' | 'pitch' | 'pro';
  prompts: string[];
  website_url?: string;
}): Promise<BrandDetail> {
  const res = await api.post<BrandDetail>('/brands', data);
  invalidateCache('/brands');
  return res.data;
}

export async function updateBrand(
  id: number,
  data: Partial<{ name: string; tier: string; website_url: string | null }>
): Promise<BrandDetail> {
  const res = await api.put<BrandDetail>(`/brands/${id}`, data);
  invalidateCache('/brands');
  return res.data;
}

export async function fetchWebsiteContext(url: string, brandName?: string): Promise<{ context: string; description: string | null }> {
  const res = await api.post<{ context: string; description: string | null }>('/brands/fetch-website-context', { url, brand_name: brandName || '' });
  return res.data;
}

export async function refreshWebsiteContext(brandId: number): Promise<void> {
  await api.post(`/brands/${brandId}/refresh-website-context`);
  invalidateCache(`/brands/${brandId}/profile`);
}

/**
 * Normalise a website URL entered by the user.
 * Prepends "https://" if no protocol is present.
 * Returns null if the input is empty, or the normalised URL string.
 */
export function normaliseWebsiteUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) return 'https://' + trimmed;
  return trimmed;
}

export async function deleteBrand(id: number): Promise<void> {
  await api.delete(`/brands/${id}`);
  invalidateCache('/brands');
}

export async function addPrompt(brandId: number, text: string): Promise<Prompt> {
  const res = await api.post<Prompt>(`/brands/${brandId}/prompts`, { text });
  invalidateCache(`/brands/${brandId}`);
  return res.data;
}

export async function deletePrompt(brandId: number, promptId: number): Promise<void> {
  await api.delete(`/brands/${brandId}/prompts/${promptId}`);
  invalidateCache(`/brands/${brandId}`);
}

export async function updatePrompt(brandId: number, promptId: number, text: string): Promise<Prompt> {
  const res = await api.patch<Prompt>(`/brands/${brandId}/prompts/${promptId}`, { text });
  return res.data;
}

export interface InferScopeResult {
  market_scope: 'local' | 'national' | 'global' | 'niche';
  geography: string | null;
}

export async function inferBrandScope(brandId: number): Promise<InferScopeResult> {
  const res = await api.post<InferScopeResult>(`/brands/${brandId}/infer-scope`);
  return res.data;
}

export async function triggerRun(brandId: number): Promise<{ run_id: number }> {
  const res = await api.post<{ run_id: number }>(`/tracking/run/${brandId}`);
  invalidateCache(`/tracking/runs/${brandId}`);
  return res.data;
}

export async function getRunStatus(runId: number): Promise<TrackingRun> {
  const res = await api.get<TrackingRun>(`/tracking/run/${runId}/status`);
  // When a run completes/fails, bust all caches that depend on run results
  // so loadData() re-fetches fresh data rather than hitting the TTL cache.
  if (res.data.status === 'completed' || res.data.status === 'failed') {
    invalidateCache('/tracking/runs/');
    invalidateCache(`/results/${res.data.brand_id}/`);
    invalidateCache(`/dashboard/${res.data.brand_id}/`);
  }
  return res.data;
}

export async function cancelRun(runId: number): Promise<void> {
  await api.post(`/tracking/run/${runId}/cancel`);
  invalidateCache('/tracking/runs/');
}

export async function getRecentRuns(brandId: number): Promise<TrackingRun[]> {
  return dedupedGet<TrackingRun[]>(`/tracking/runs/${brandId}`);
}

export async function getOverview(brandId: number): Promise<OverviewData> {
  return dedupedGet<OverviewData>(`/results/${brandId}/overview`);
}

interface TrendsApiResponse {
  brand_id: number;
  brand_name: string;
  trend_data: Array<{
    run_id: number;
    overall_score: number | null;
    completed_at: string | null;
    created_at: string;
    total_queries: number | null;
    total_mentions: number | null;
  }>;
}

export async function getTrends(brandId: number): Promise<TrendPoint[]> {
  const res = await dedupedGet<TrendsApiResponse>(`/results/${brandId}/trends`);
  return (res.trend_data ?? []).map((p) => ({
    run_id: p.run_id,
    score: p.overall_score ?? 0,
    completed_at: p.completed_at ?? p.created_at,
    total_queries: p.total_queries ?? 0,
    total_mentions: p.total_mentions ?? 0,
    model_scores: (p as Record<string, unknown>).model_scores as Record<string, number> ?? {},
  }));
}

interface PaginatedQueryResults {
  total: number;
  page: number;
  page_size: number;
  items: QueryResult[];
}

export async function getResponses(
  brandId: number,
  runId?: number,
  pageSize = 500
): Promise<QueryResult[]> {
  const params: Record<string, unknown> = { page_size: pageSize };
  if (runId) params.run_id = runId;
  const data = await dedupedGet<PaginatedQueryResults>(`/results/${brandId}/responses`, params);
  return data.items;
}

// ── Content functions ────────────────────────────────────────────────────────

export async function getDrafts(
  brandId: number,
  platform?: string,
  status?: string,
  pageSize = 100
): Promise<ContentDraft[]> {
  const params: Record<string, string | number> = { page_size: pageSize };
  if (platform) params.platform = platform;
  if (status) params.status = status;
  const res = await api.get<ContentDraft[]>(`/content/${brandId}/drafts`, { params });
  return res.data;
}

export async function generateDraft(
  brandId: number,
  data: {
    platform: string;
    prompt_id?: number;
    custom_brief?: string;
    quora_question_url?: string;
    quora_question_title?: string;
    quora_question_snippet?: string;
  }
): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(`/content/${brandId}/draft`, data);
  return res.data;
}

export async function updateDraft(
  draftId: number,
  data: { title?: string; content_text?: string; status?: string; prompt_id?: number }
): Promise<ContentDraft> {
  const res = await api.put<ContentDraft>(`/content/draft/${draftId}`, data);
  invalidateCache('/content/');
  return res.data;
}

export async function deleteDraft(draftId: number): Promise<void> {
  await api.delete(`/content/draft/${draftId}`);
  invalidateCache('/content/');
}

export interface PromptSuggestion {
  prompt_id: number;
  text: string;
  score: number;
  label: 'very_relevant' | 'somewhat' | 'loose';
}

export async function getPromptSuggestions(draftId: number): Promise<PromptSuggestion[]> {
  const res = await api.get<PromptSuggestion[]>(`/content/draft/${draftId}/prompt-suggestions`);
  return res.data;
}

export interface GenerateNowOptions {
  /** Only (re)generate pending/failed clusters — never clobbers existing work. */
  skipReady?: boolean;
  /** Only process pending/briefing_failed/generation_partial clusters. Takes
   * precedence over skipReady on the backend. */
  retryFailed?: boolean;
}

export async function generateNow(
  brandId: number,
  maxGaps = 20,
  options: GenerateNowOptions = {},
): Promise<void> {
  await api.post(`/content/${brandId}/generate-now`, {
    max_gaps: maxGaps,
    skip_ready: options.skipReady ?? false,
    retry_failed: options.retryFailed ?? false,
  });
}

export interface DraftQueueStatus {
  draft_count: number;
  draft_cap: number;
  draft_queue_full: boolean;
  scheduled_count: number;
  scheduled_cap: number;
  scheduled_queue_full: boolean;
  last_scan_at: string | null;
  next_generate_at?: string | null;
  generating?: boolean;
  weekly_drafts_remaining: number | null;  // null = admin (unlimited)
  weekly_drafts_limit: number | null;       // null = admin (unlimited)
  show_upgrade?: boolean;
}

/** Bypass cache — used during generation polling where fresh data is critical. */
export async function getDraftStatusFresh(brandId: number): Promise<DraftQueueStatus> {
  invalidateCache(`/content/${brandId}/draft-status`);
  const res = await api.get<DraftQueueStatus>(`/content/${brandId}/draft-status`);
  return res.data;
}

export interface ContentReadinessWarning {
  code: string;
  message: string;
}

export interface ContentReadiness {
  profile_completion_pct: number;
  profile_empty: boolean;
  source_count: number;
  has_completed_run: boolean;
  warnings: ContentReadinessWarning[];
}

/** Preflight check surfaced before bulk generation — never blocks generation
 * on its own; callers should proceed if this call fails. */
export async function getContentReadiness(brandId: number): Promise<ContentReadiness> {
  const res = await api.get<ContentReadiness>(`/content/${brandId}/readiness`);
  return res.data;
}

// ── Opportunity functions ────────────────────────────────────────────────────

export async function getOpportunities(brandId: number): Promise<ContentOpportunity[]> {
  return dedupedGet<ContentOpportunity[]>(`/opportunities/${brandId}`);
}

export async function triggerScan(brandId: number): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>(`/opportunities/${brandId}/scan`);
  invalidateCache('/opportunities/');
  return res.data;
}

export interface SchedulerStatus {
  paused: boolean;
  status: 'active' | 'paused';
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const res = await api.get<SchedulerStatus>('/settings/scheduler');
  return res.data;
}

export async function setSchedulerStatus(paused: boolean): Promise<SchedulerStatus> {
  const res = await api.post<SchedulerStatus>('/settings/scheduler', { paused });
  return res.data;
}

// ── Competitor types & functions ─────────────────────────────────────────────

export interface Competitor {
  id: number;
  brand_id: number;
  name: string;
  created_at: string;
}

export async function getCompetitors(brandId: number): Promise<Competitor[]> {
  return dedupedGet<Competitor[]>(`/brands/${brandId}/competitors`);
}

export async function addCompetitor(brandId: number, name: string): Promise<Competitor> {
  const res = await api.post<Competitor>(`/brands/${brandId}/competitors`, { name });
  invalidateCache(`/brands/${brandId}/competitors`);
  return res.data;
}

export async function removeCompetitor(brandId: number, competitorId: number): Promise<void> {
  await api.delete(`/brands/${brandId}/competitors/${competitorId}`);
  invalidateCache(`/brands/${brandId}/competitors`);
}

// ── Competitor analysis types & functions ─────────────────────────────────────

export interface CompetitorByModel {
  name: string;
  rate: number;
  by_model: Record<string, number>;
}

export interface CompetitorPromptResult {
  prompt_id: number;
  prompt_text: string;
  brand_rate: number;
  brand_by_model: Record<string, number>;
  outcome: 'win' | 'lose' | 'tie';
  competitors: CompetitorByModel[];
}

export interface CompetitorAnalysis {
  brand_id: number;
  brand_name: string;
  run_id: number | null;
  has_data: boolean;
  overall: {
    brand_name: string;
    brand_pct: number;
    competitors: { name: string; pct: number }[];
  };
  prompts: CompetitorPromptResult[];
}

export async function getCompetitorAnalysis(
  brandId: number,
  runId?: number,
): Promise<CompetitorAnalysis> {
  const params: Record<string, unknown> = {};
  if (runId) params.run_id = runId;
  const res = await api.get<CompetitorAnalysis>(`/brands/${brandId}/competitor-analysis`, { params });
  return res.data;
}

export async function getSuggestedPrompts(brandId: number): Promise<string[]> {
  const res = await api.post<string[]>(`/brands/${brandId}/suggest-prompts`);
  return res.data;
}

export async function getSuggestedPromptsPreview(
  name: string,
  description?: string,
  websiteContext?: string,
): Promise<string[]> {
  const res = await api.post<string[]>('/brands/suggest-prompts-preview', {
    name,
    description: description ?? '',
    website_context: websiteContext ?? '',
  });
  return res.data;
}

// ── Dashboard analytics types & functions ────────────────────────────────────

export interface SOVData {
  percentage: number;
  brand_mentions: number;
  total_mentions: number;
  has_competitors: boolean;
}

export interface SentimentBreakdown {
  positive_pct: number;
  neutral_pct: number;
  negative_pct: number;
  has_data: boolean;
  /** Mentions with no stored sentiment (classifier failed/skipped). */
  unclassified_mentions: number;
  /** How many classified mentions the percentages are based on. */
  classified_mentions: number;
}

export interface PositionData {
  score: number | null;
  label: string;
  sample_count: number;
}

export interface DomainStat {
  domain: string;
  count: number;
  pct: number;
  domain_type: string;
}

export interface ConversationItem {
  id: number;
  prompt_text: string;
  model: string;
  mentioned: boolean;
  response_preview: string;
  response_text: string | null;
  created_at: string;
}

export interface CompetitorStat {
  name: string;
  mention_count: number;
  mention_rate: number;
  is_primary: boolean;
}

export interface ModelStat {
  model: string;
  label: string;
  mention_count: number;
  total: number;
  mention_rate: number;
}

export interface CitationGap {
  domain: string;
  domain_type: string;
  cited_total: number;
  cited_with_brand: number;
  gap_score: number;
  platform?: string;
}

export interface DashboardAnalytics {
  brand_id: number;
  brand_name: string;
  sov: SOVData;
  sentiment: SentimentBreakdown;
  position: PositionData;
  top_domains: DomainStat[];
  recent_conversations: ConversationItem[];
  competitor_comparison: CompetitorStat[];
  model_breakdown: ModelStat[];
  citation_gaps: CitationGap[];
  total_responses_analyzed: number;
  score_confidence: 'low' | 'medium' | 'high';
  active_models: number;
}

export async function getDashboardAnalytics(brandId: number): Promise<DashboardAnalytics> {
  return dedupedGet<DashboardAnalytics>(`/dashboard/${brandId}/analytics`);
}

// ── Competitive Gap ───────────────────────────────────────────────────────────

export type CompetitiveGapWindow = '7d' | '30d' | '90d';

export interface CompetitiveGapTrendPoint {
  date: string;
  gap_pp: number;
  brand_pct: number;
  comp_avg_pct: number;
}

export interface CompetitorTrendPoint {
  date: string;
  gap_pp: number;
}

export interface CompetitorGapStat {
  competitor_id: number;
  name: string;
  competitor_pct: number;
  gap_pp: number;
  delta_pp: number | null;
  trend: CompetitorTrendPoint[];
  has_data: boolean;
}

export interface CompetitiveGapResponse {
  brand_id: number;
  window: CompetitiveGapWindow;
  has_competitors: boolean;
  has_data: boolean;
  headline_gap_pp: number | null;
  headline_delta_pp: number | null;
  brand_visibility_pct: number | null;
  competitor_avg_pct: number | null;
  trend: CompetitiveGapTrendPoint[];
  competitors: CompetitorGapStat[];
  sample_count: number;
  confidence: 'low' | 'medium' | 'high';
}

export async function getCompetitiveGap(
  brandId: number,
  window: CompetitiveGapWindow = '7d',
): Promise<CompetitiveGapResponse> {
  const res = await api.get<CompetitiveGapResponse>(
    `/dashboard/${brandId}/competitive-gap`,
    { params: { window } },
  );
  return res.data;
}

// ── Brand with stats (for brand switcher) ────────────────────────────────────

export interface BrandWithStats {
  id: number;
  name: string;
  slug: string;
  tier: 'basic' | 'standard' | 'premium';
  brand_type: 'standard' | 'pitch' | 'pro';
  prompt_limit: number;
  pitch_expires_at: string | null;
  prompt_count: number;
  overall_score: number | null;
  last_run_at: string | null;
  trend: 'up' | 'down' | 'flat';
  created_at: string;
  updated_at: string;
}

// ── Brand Profile functions ───────────────────────────────────────────────────

export interface Publication {
  url: string;
  title: string;
  publisher: string;
  date: string;
}

export interface BrandProfile {
  id: number;
  brand_id: number;
  company_description: string | null;
  key_stats: string[];
  tone_of_voice: string | null;
  what_not_to_say: string[];
  approved_language: string[];
  publications: Publication[];
  completion_pct: number;
  internal_brand_context: string | null;
  website_context_last_fetched: string | null;
  market_scope: 'local' | 'national' | 'global' | 'niche' | null;
  geography: string | null;
  target_audience: string | null;
  created_at: string;
  updated_at: string;
}

export async function getBrandProfile(brandId: number): Promise<BrandProfile> {
  return dedupedGet<BrandProfile>(`/brands/${brandId}/profile`);
}

export async function updateBrandProfile(
  brandId: number,
  data: Partial<{
    company_description: string;
    key_stats: string[];
    tone_of_voice: string;
    what_not_to_say: string[];
    approved_language: string[];
    publications: Publication[];
    internal_brand_context: string;
    market_scope: 'local' | 'national' | 'global' | 'niche' | null;
    geography: string | null;
    target_audience: string;
    clear_fields: string[];
  }>
): Promise<BrandProfile> {
  const res = await api.put<BrandProfile>(`/brands/${brandId}/profile`, data);
  invalidateCache(`/brands/${brandId}/profile`);
  return res.data;
}

export interface AiFillProfileResult {
  company_description: string | null;
  tone_of_voice: string | null;
  key_stats: string[];
  target_audience?: string | null;
  persisted_fields?: string[];
}

export async function aiFillProfile(brandId: number): Promise<AiFillProfileResult> {
  const res = await api.post<AiFillProfileResult>(`/brands/${brandId}/profile/ai-fill`);
  return res.data;
}

// ── Brand sources ─────────────────────────────────────────────────────────────

export interface BrandSource {
  id: number;
  title: string;
  url: string;
  snippet: string | null;
  source_type: 'paper' | 'article' | 'stat' | 'case_study';
  added_at: string;
}

export async function addBrandSource(
  brandId: number,
  payload: { url: string; title?: string; snippet?: string; source_type?: string },
): Promise<BrandSource> {
  const res = await api.post<BrandSource>(`/brands/${brandId}/sources`, payload);
  invalidateCache(`/brands/${brandId}/sources`);
  return res.data;
}

export async function listBrandSources(brandId: number): Promise<BrandSource[]> {
  return dedupedGet<BrandSource[]>(`/brands/${brandId}/sources`);
}

export async function deleteBrandSource(brandId: number, sourceId: number): Promise<void> {
  await api.delete(`/brands/${brandId}/sources/${sourceId}`);
  invalidateCache(`/brands/${brandId}/sources`);
}

// ── Voice samples ─────────────────────────────────────────────────────────────

export interface VoiceSample {
  index: number;
  title: string;
  text: string;
}

export async function addVoiceSample(
  brandId: number,
  payload: { title: string; text: string },
): Promise<VoiceSample> {
  const res = await api.post<VoiceSample>(`/brands/${brandId}/voice-samples`, payload);
  invalidateCache(`/brands/${brandId}/voice-samples`);
  return res.data;
}

export async function listVoiceSamples(brandId: number): Promise<VoiceSample[]> {
  return dedupedGet<VoiceSample[]>(`/brands/${brandId}/voice-samples`);
}

export async function deleteVoiceSample(brandId: number, index: number): Promise<void> {
  await api.delete(`/brands/${brandId}/voice-samples/${index}`);
  invalidateCache(`/brands/${brandId}/voice-samples`);
}

// ── Content Gap functions ─────────────────────────────────────────────────────

export interface QuoraQuestion {
  title: string;
  url: string;
  snippet: string;
}

export interface ContentGap {
  id: number;
  brand_id: number;
  prompt_id: number;
  prompt_text: string | null;
  tracking_run_id: number;
  model: string | null;
  severity_score: number;
  opportunity_score: number;
  recency_score: number;
  gap_score: number;
  competitor_mentions: Record<string, number>;
  platforms_lacking: string[];
  quora_questions: QuoraQuestion[];
  prompt_visibility: number | null;
  last_content_at: string | null;
  identified_at: string;
  created_at: string;
}

export interface GapSummary {
  brand_id: number;
  total_gaps: number;
  avg_gap_score: number;
  avg_prompt_visibility: number;
  top_competitors: { name: string; mention_count: number }[];
}

export async function getContentGaps(brandId: number): Promise<ContentGap[]> {
  return dedupedGet<ContentGap[]>(`/gaps/${brandId}`);
}

// ── Auth types & functions ────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: 'basic' | 'starter' | 'pro' | null;
  subscription_status: string | null;
  subscription_trial_end: string | null;
  is_admin: boolean;
  is_agency_staff?: boolean;
  prompt_limit: number;
  totp_enabled: boolean;
  created_at: string;
  email_verified: boolean;
  is_team_member?: boolean;
  team_owner_name?: string | null;
  team_owner_email?: string | null;
}

// ── Agency portal ────────────────────────────────────────────────────────────

export interface AgencyClient {
  id: number;
  name: string;
  slug: string;
  status: 'onboarding' | 'active' | 'paused' | 'churned';
  retainer_amount_usd: number | null;
  retainer_started_at: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  brand_id: number | null;
  drafts_pending: number;
  created_at: string;
  current_proposal_doc_url: string | null;
  current_proposal_label: string | null;
}

export interface AgencyClientCreate {
  name: string;
  status?: string;
  retainer_amount_usd?: number;
  primary_contact_name?: string;
  primary_contact_email?: string;
}

export async function agencyListClients(): Promise<AgencyClient[]> {
  const res = await api.get<AgencyClient[]>('/agency/clients');
  return res.data;
}

export async function agencyGetClient(id: number): Promise<AgencyClient> {
  const res = await api.get<AgencyClient>(`/agency/clients/${id}`);
  return res.data;
}

export async function agencyCreateClient(body: AgencyClientCreate): Promise<AgencyClient> {
  const res = await api.post<AgencyClient>('/agency/clients', body);
  return res.data;
}

export async function agencyUpdateClient(
  id: number,
  body: Partial<AgencyClientCreate> & { status?: string },
): Promise<AgencyClient> {
  const res = await api.patch<AgencyClient>(`/agency/clients/${id}`, body);
  return res.data;
}

// ── Agency portal shell (2026-05-11) ─────────────────────────────────────────

export interface ReviewLinkOut {
  token: string;
  url: string;
  created_at: string;
}

export type DraftStaffStatus =
  | 'draft'
  | 'awaiting_client'
  | 'approved'
  | 'posted'
  | 'dismissed';

export async function agencyGetReviewLink(clientId: number): Promise<ReviewLinkOut | null> {
  const res = await api.get<ReviewLinkOut | null>(`/agency/clients/${clientId}/review-link`);
  return res.data;
}

export async function agencyRotateReviewLink(clientId: number): Promise<ReviewLinkOut> {
  const res = await api.post<ReviewLinkOut>(`/agency/clients/${clientId}/review-link`);
  return res.data;
}

export async function agencyUpdateDraftStatus(
  draftId: number,
  status: DraftStaffStatus,
): Promise<void> {
  await api.patch(`/agency/drafts/${draftId}/status`, { status });
}

// ── Agency video pipeline ──────────────────────────────────────────────────

export interface VideoChapter {
  ts_seconds: number;
  label: string;
}

export interface VideoMetadataJobOut {
  id: number;
  agency_client_id: number;
  brand_id: number;
  status: 'uploaded' | 'transcribing' | 'generating' | 'completed' | 'failed';
  filename: string;
  file_size_bytes: number;
  duration_seconds: number | null;
  transcript_text: string | null;
  transcript_segments: { start: number; end: number; text: string }[] | null;
  ai_title: string | null;
  ai_description: string | null;
  ai_chapters: VideoChapter[] | null;
  ai_tags: string[] | null;
  ai_jsonld: Record<string, unknown> | null;
  srt_content: string | null;
  vtt_content: string | null;
  metadata_failed: boolean;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
}

export async function agencyUploadVideo(
  clientId: number,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ job_id: number; status: string }> {
  const form = new FormData();
  form.append('file', file);
  const resp = await api.post<{ job_id: number; status: string }>(
    `/api/agency/clients/${clientId}/video/upload`,
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    },
  );
  return resp.data;
}

export async function agencyGetVideoJobs(clientId: number): Promise<VideoMetadataJobOut[]> {
  const res = await api.get<VideoMetadataJobOut[]>(`/api/agency/clients/${clientId}/video/jobs`);
  return res.data;
}

export async function agencyRegenerateVideoMetadata(
  clientId: number,
  jobId: number,
): Promise<VideoMetadataJobOut> {
  const res = await api.post<VideoMetadataJobOut>(
    `/api/agency/clients/${clientId}/video/jobs/${jobId}/regenerate-metadata`,
  );
  return res.data;
}

// ── Public review (no auth) ──────────────────────────────────────────────────

export interface ReviewDraft {
  id: number;
  title: string | null;
  platform: string;
  content_text: string;
  created_at: string;
}

export interface ReviewClientPage {
  client_name: string;
  drafts: ReviewDraft[];
}

export async function publicApproveDraft(token: string, draftId: number): Promise<void> {
  await api.post(`/public/review/${token}/draft/${draftId}/approve`);
}

export async function publicRequestChanges(
  token: string,
  draftId: number,
  feedback: string,
): Promise<void> {
  await api.post(`/public/review/${token}/draft/${draftId}/request-changes`, { feedback });
}

export async function publicRejectDraft(
  token: string,
  draftId: number,
  reason: string,
): Promise<void> {
  await api.post(`/public/review/${token}/draft/${draftId}/reject`, { reason });
}

export interface PublicDocumentSummary {
  id: number;
  kind: string;
  title: string;
  generated_at: string;
  pdf_available: boolean;
}

export async function publicGetDocumentHtml(token: string, docId: number): Promise<string> {
  const res = await api.get<string>(`/public/review/${token}/document/${docId}`, {
    responseType: 'text',
    transformResponse: (data) => data,
  });
  return res.data;
}

export function publicDocumentPdfUrl(token: string, docId: number): string {
  // Returns an absolute URL the browser can hit directly to trigger a download.
  const base = (api.defaults.baseURL || '').replace(/\/+$/, '');
  return `${base}/public/review/${token}/document/${docId}/pdf`;
}

export interface RegisterResult {
  email: string;
  needs_verification: boolean;
}

export async function authRegister(data: {
  email: string;
  password: string;
  name?: string;
}): Promise<RegisterResult> {
  const res = await api.post<RegisterResult>('/auth/register', data);
  return res.data;
}

export interface Login2FAResult {
  requires_2fa: true;
  challenge_token: string;
}

export interface LoginNeedsVerificationResult {
  needs_verification: true;
  email: string;
}

export type LoginResult = Login2FAResult | LoginNeedsVerificationResult;

export async function authLogin(email: string, password: string): Promise<AuthUser | LoginResult> {
  const res = await api.post<AuthUser | LoginResult>('/auth/login', { email, password });
  return res.data;
}

export async function authLogout(): Promise<void> {
  await api.post('/auth/logout');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
  return res.data;
}

export async function authVerifyEmail(email: string, code: string): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/verify-email', { email, code });
  return res.data;
}

export async function authResendVerification(email: string): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/resend-verification', { email });
  return res.data;
}

export async function authMe(): Promise<AuthUser> {
  const res = await api.get<AuthUser>('/auth/me');
  return res.data;
}

export async function getGoogleAuthUrl(redirectTo: string = '/dashboard'): Promise<string> {
  const res = await api.get<{ url: string }>('/auth/google/url', { params: { redirect_to: redirectTo } });
  return res.data.url;
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/forgot-password', { email });
  return res.data;
}

export async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/auth/reset-password', {
    token,
    new_password: newPassword,
  });
  return res.data;
}

// ── Billing types & functions ─────────────────────────────────────────────────

export interface BillingStatus {
  subscription_tier: 'basic' | 'starter' | 'pro' | null;
  subscription_status: string | null;
  subscription_trial_end: string | null;
  days_remaining: number | null;
  prompt_limit: number;
  brand_limits: { standard: number; pitch: number };
  is_admin: boolean;
  has_payment_method: boolean;
  pending_tier: 'basic' | 'starter' | 'pro' | null;
  pending_tier_effective_at: string | null;
}

export interface BillingUsage {
  manual_runs_today: number;
  manual_run_limit: number | null;  // null = unlimited (Pro / admin)
  prompt_count: number;
  prompt_limit: number;
  standard_brand_count: number;
  standard_brand_limit: number;
  pitch_brand_count: number;
  pitch_brand_limit: number;
}

export async function getBillingStatus(): Promise<BillingStatus> {
  const res = await api.get<BillingStatus>('/billing/status');
  return res.data;
}

export async function getBillingUsage(): Promise<BillingUsage> {
  const res = await api.get<BillingUsage>('/billing/usage');
  return res.data;
}

export async function createCheckoutSession(
  tier: string,
  successUrl?: string,
  cancelUrl?: string,
): Promise<{ checkout_url: string }> {
  // Backend appends trial=true to the success URL for trial tiers — just pass the base URL
  const res = await api.post<{ checkout_url: string }>('/billing/create-checkout', {
    tier,
    success_url: successUrl ?? `${window.location.origin}/settings/billing?success=true`,
    cancel_url: cancelUrl ?? `${window.location.origin}/settings/billing`,
  });
  return res.data;
}

export async function createPortalSession(): Promise<{ portal_url: string }> {
  const res = await api.post<{ portal_url: string }>('/billing/portal', {
    return_url: `${window.location.origin}/account`,
  });
  return res.data;
}

export async function cancelSubscription(): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/billing/cancel');
  return res.data;
}

export async function changePlan(tier: string): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>('/billing/change-plan', { tier });
  return res.data;
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  is_admin: boolean;
  is_paused: boolean;
  created_at: string | null;
  brand_count: number;
  brands: { id: number; name: string; brand_type: string }[];
  last_active: string | null;
}

export interface AdminRun {
  id: number;
  brand_id: number;
  brand_name: string;
  user_email: string | null;
  status: string;
  run_type: string;
  overall_score: number | null;
  total_queries: number | null;
  total_mentions: number | null;
  created_at: string | null;
  completed_at: string | null;
}

export interface AdminStats {
  total_users: number;
  total_brands: number;
  total_prompts: number;
  total_drafts: number;
  runs_today: number;
}

export async function adminGetUsers(): Promise<AdminUser[]> {
  const res = await api.get<AdminUser[]>('/admin/users');
  return res.data;
}

export async function adminGetRuns(): Promise<AdminRun[]> {
  const res = await api.get<AdminRun[]>('/admin/runs');
  return res.data;
}

export async function adminGetStats(): Promise<AdminStats> {
  const res = await api.get<AdminStats>('/admin/stats');
  return res.data;
}

export async function adminTriggerRun(brandId: number): Promise<{ run_id: number; status: string }> {
  const res = await api.post<{ run_id: number; status: string }>(`/admin/trigger-run/${brandId}`);
  return res.data;
}

export async function adminGetLogs(lines = 100): Promise<{ lines: string[]; exists: boolean }> {
  const res = await api.get<{ lines: string[]; exists: boolean }>(`/admin/logs?lines=${lines}`);
  return res.data;
}

export async function adminPauseUser(userId: number): Promise<{ user_id: number; is_paused: boolean; action: string }> {
  const res = await api.post<{ user_id: number; is_paused: boolean; action: string }>(`/admin/users/${userId}/pause`);
  return res.data;
}

export async function adminRemoveUser(userId: number): Promise<{ user_id: number; deleted: boolean }> {
  const res = await api.delete<{ user_id: number; deleted: boolean }>(`/admin/users/${userId}`);
  return res.data;
}

export async function adminGenerateDraft(brandId: number): Promise<{ brand_id: number; status: string }> {
  const res = await api.post<{ brand_id: number; status: string }>(`/admin/generate-draft/${brandId}`);
  return res.data;
}

export interface AdminUserDetail {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: string | null;
  subscription_status: string | null;
  trial_end: string | null;
  email_verified: boolean;
  is_paused: boolean;
  is_admin: boolean;
  created_at: string | null;
  stripe_customer_id: string | null;
  google_id: string | null;
  totp_enabled: boolean;
  brand_count: number;
  total_runs: number;
  total_drafts: number;
  last_active: string | null;
}

export interface AdminEditUserPayload {
  subscription_tier?: string | null;
  subscription_status?: string | null;
  trial_end?: string | null;
  email_verified?: boolean;
  is_paused?: boolean;
  name?: string;
}

export interface AdminBrandDetail {
  id: number;
  name: string;
  slug: string;
  tier: string;
  brand_type: string;
  website_url: string | null;
  latest_score: number | null;
  prompts: { id: number; text: string; prompt_type: string }[];
  competitors: { id: number; name: string; website_url: string | null }[];
}

export interface AdminUserRun {
  id: number;
  brand_id: number;
  brand_name: string;
  status: string;
  run_type: string;
  overall_score: number | null;
  total_queries: number | null;
  total_mentions: number | null;
  created_at: string | null;
  completed_at: string | null;
}

export async function adminGetUser(userId: number): Promise<AdminUserDetail> {
  const res = await api.get<AdminUserDetail>(`/admin/users/${userId}`);
  return res.data;
}

export async function adminEditUser(userId: number, payload: AdminEditUserPayload): Promise<AdminUserDetail> {
  const res = await api.patch<AdminUserDetail>(`/admin/users/${userId}`, payload);
  return res.data;
}

export async function adminGetUserRuns(userId: number): Promise<AdminUserRun[]> {
  const res = await api.get<AdminUserRun[]>(`/admin/users/${userId}/runs`);
  return res.data;
}

export async function adminGetUserBrands(userId: number): Promise<AdminBrandDetail[]> {
  const res = await api.get<AdminBrandDetail[]>(`/admin/users/${userId}/brands`);
  return res.data;
}

export async function adminEditBrand(brandId: number, payload: { name?: string; slug?: string; tier?: string; brand_type?: string; website_url?: string }): Promise<{ brand_id: number; updated: string[] }> {
  const res = await api.patch<{ brand_id: number; updated: string[] }>(`/admin/brands/${brandId}`, payload);
  return res.data;
}

export async function adminAddPrompt(brandId: number, text: string, promptType = 'standard'): Promise<{ id: number; text: string; prompt_type: string }> {
  const res = await api.post<{ id: number; text: string; prompt_type: string }>(`/admin/brands/${brandId}/prompts`, { text, prompt_type: promptType });
  return res.data;
}

export async function adminEditPrompt(promptId: number, text: string): Promise<{ id: number; text: string; prompt_type: string }> {
  const res = await api.patch<{ id: number; text: string; prompt_type: string }>(`/admin/prompts/${promptId}`, { text });
  return res.data;
}

export async function adminDeletePrompt(promptId: number): Promise<{ prompt_id: number; deleted: boolean }> {
  const res = await api.delete<{ prompt_id: number; deleted: boolean }>(`/admin/prompts/${promptId}`);
  return res.data;
}

export async function adminAddCompetitor(brandId: number, name: string, websiteUrl?: string): Promise<{ id: number; name: string; website_url: string | null }> {
  const res = await api.post<{ id: number; name: string; website_url: string | null }>(`/admin/brands/${brandId}/competitors`, { name, website_url: websiteUrl });
  return res.data;
}

export async function adminDeleteCompetitor(competitorId: number): Promise<{ competitor_id: number; deleted: boolean }> {
  const res = await api.delete<{ competitor_id: number; deleted: boolean }>(`/admin/competitors/${competitorId}`);
  return res.data;
}

export async function adminImpersonate(userId: number): Promise<{ admin_token: string; target_token: string; target_user_id: number; target_user_email: string }> {
  const res = await api.post<{ admin_token: string; target_token: string; target_user_id: number; target_user_email: string }>(`/admin/impersonate/${userId}`);
  return res.data;
}

export async function adminExitImpersonation(adminToken: string): Promise<{ restored: boolean; admin_user_id: number; admin_token: string }> {
  const res = await api.post<{ restored: boolean; admin_user_id: number; admin_token: string }>('/admin/exit-impersonation', { admin_token: adminToken });
  return res.data;
}

/**
 * Set a JWT as the session cookie via the Next.js Route Handler.
 * Bypasses the rewrite proxy to guarantee the httpOnly cookie is set.
 */
export async function swapSessionToken(token: string): Promise<void> {
  await fetch('/api/auth/swap-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    credentials: 'same-origin',
  });
}

export async function exportReportPDF(brandId: number, days = 0): Promise<void> {
  const res = await api.get(`/reports/${brandId}/export`, { responseType: 'blob', params: days > 0 ? { days } : undefined });
  const blob = new Blob([res.data], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const disp: string = res.headers['content-disposition'] ?? '';
  const match = disp.match(/filename="?([^"]+)"?/);
  a.download = match ? match[1] : `visibility-report-${brandId}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Draft Attribution ──────────────────────────────────────────────────────────

export interface DraftAttribution {
  id: number;
  draft_id: number;
  brand_id: number;
  prompt_id: number | null;
  prompt_text: string | null;
  draft_title: string | null;
  draft_platform: string | null;
  posted_at: string;
  score_at_posting: number | null;
  current_score: number | null;
  delta: number | null;
  runs_since_posting: number;
  created_at: string;
}

export async function getDraftAttributions(brandId: number): Promise<DraftAttribution[]> {
  const res = await api.get<DraftAttribution[]>(`/brands/${brandId}/content-attribution`);
  return res.data;
}

// ── Team Members ──────────────────────────────────────────────────────────────

export interface TeamMember {
  id: number;
  invited_email: string;
  user_id: number | null;
  role: string;
  accepted: boolean;
  invited_at: string;
  accepted_at: string | null;
}

export interface InviteResponse {
  id: number;
  invite_link: string;
  message: string;
}

export async function getTeamMembers(): Promise<TeamMember[]> {
  const res = await api.get<TeamMember[]>('/team/members');
  return res.data;
}

export async function inviteTeamMember(email: string): Promise<InviteResponse> {
  const res = await api.post<InviteResponse>('/team/invite', { email });
  return res.data;
}

export async function removeTeamMember(memberId: number): Promise<void> {
  await api.delete(`/team/members/${memberId}`);
}

export async function acceptTeamInvite(token: string): Promise<{ message: string; account_owner_id: number }> {
  const res = await api.get<{ message: string; account_owner_id: number }>(`/team/accept?token=${token}`);
  return res.data;
}

export interface InviteInfo {
  invited_email: string;
  inviter_name: string;
  expires_at: string;
}

// ── Notifications ─────────────────────────────────────────────────────────────

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  notifications: AppNotification[];
  unread_count: number;
}

export async function getNotifications(): Promise<NotificationsResponse> {
  const res = await api.get<NotificationsResponse>('/notifications');
  return res.data;
}

export async function markAllNotificationsRead(): Promise<NotificationsResponse> {
  const res = await api.post<NotificationsResponse>('/notifications/read-all');
  return res.data;
}

// ── Quora question search ──────────────────────────────────────────────────────

// ── Support ────────────────────────────────────────────────────────────────────

export async function submitSupportRequest(subject: string, message: string): Promise<void> {
  await api.post('/support/contact', { subject, message });
}

// ── Two-Factor Authentication ──────────────────────────────────────────────────

export interface TotpSetupData {
  secret: string;
  otpauth_uri: string;
  qr_code: string;
}

export async function verify2fa(challenge_token: string, code: string): Promise<AuthUser> {
  const res = await api.post<AuthUser>('/auth/2fa/verify', { challenge_token, code });
  return res.data;
}

// ── Background task status ─────────────────────────────────────────────────────

export interface BackgroundStatus {
  report_running: boolean;
  drafts_generating: boolean;
  scanning: boolean;
  model_scores: Array<{ model: string; score: number }>;
  prompt_count: number;
}

export async function getBackgroundStatus(): Promise<BackgroundStatus> {
  const res = await api.get<BackgroundStatus>('/tracking/background-status');
  return res.data;
}

// ── Prompt Intelligence ─────────────────────────────────────────────────────

export interface PromptTimelinePoint {
  run_id: number;
  completed_at: string | null;
  scores: Record<string, number>;
  overall: number;
}

export interface ContentEventItem {
  id: number;
  event_type: string;
  created_at: string;
  data: Record<string, unknown> | null;
}

export interface PromptTimelineData {
  prompt_id: number;
  prompt_text: string;
  timeline: PromptTimelinePoint[];
  content_events: ContentEventItem[];
  current_scores: Record<string, number>;
  total_drafts_targeting: number;
  latest_draft_posted_at: string | null;
}

export interface PromptDraftSnapshot {
  id: number;
  platform: string;
  status: string;
  posted_at: string | null;
  visibility_at_post: number | null;
  content_preview: string;
  score_snapshot: {
    at_posting: number | null;
    current: number | null;
    delta: number | null;
    runs_since: number | null;
  };
}

export interface PromptInsightData {
  id: string;
  message: string;
  severity: 'positive' | 'warning' | 'negative' | 'info';
  model: string | null;
}

export interface PromptRecentResponseData {
  model: string;
  response_text: string | null;
  mentioned: boolean;
  sentiment: string | null;
  created_at: string;
}

export interface PromptCompetitorData {
  name: string;
  mention_rate: number;
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface PromptDetailData {
  prompt_id: number;
  prompt_text: string;
  prompt_type: string;
  current_scores: Record<string, number>;
  score_trend: 'improving' | 'declining' | 'stable';
  timeline: PromptTimelinePoint[];
  content_events: ContentEventItem[];
  drafts: PromptDraftSnapshot[];
  competitors: PromptCompetitorData[];
  insights: PromptInsightData[];
  recent_responses: PromptRecentResponseData[];
}

export async function getPromptDetail(brandId: number, promptId: number): Promise<PromptDetailData> {
  return dedupedGet<PromptDetailData>(`/results/${brandId}/prompt/${promptId}/detail`);
}

export interface PromptOverviewItem {
  prompt_id: number;
  prompt_text: string;
  current_overall: number;
  trend: string;
  sparkline: number[];
  model_scores: Record<string, number>;
  drafts_posted: number;
  last_draft_at: string | null;
  has_recent_content_event: boolean;
}

export interface PromptsOverviewResponse {
  prompts: PromptOverviewItem[];
}

export async function getPromptsOverview(brandId: number): Promise<PromptsOverviewResponse> {
  const res = await api.get<PromptsOverviewResponse>(`/results/${brandId}/prompts/overview`);
  return res.data;
}

// ── AI Visibility Coach ────────────────────────────────────────────────────────

export async function getCoachUsage(brandId: number): Promise<{ used: number; limit: number; resets_at: string }> {
  const { data } = await api.get<{ used: number; limit: number; resets_at: string }>(`/coach/${brandId}/usage`);
  return data;
}

// ── Site Audit (Website AIO) ──────────────────────────────────────────────────

export type WebsiteAuditSummary = {
  id: number
  brand_id: number
  status: 'pending' | 'crawling' | 'analyzing' | 'completed' | 'failed' | 'cancelled'
  started_at: string
  completed_at: string | null
  total_pages: number
  pages_failed: number
  overall_score: number | null
  bot_access_score: number | null
  content_score: number | null
  schema_score: number | null
  technical_score: number | null
  render_mode: string | null
  llms_txt_present: boolean
  llms_txt_valid: boolean
  robots_txt_raw: string | null
  error_message: string | null
  cms_platform?: string | null
}

export type WebsiteAuditPageOut = {
  id: number
  audit_id: number
  url: string
  page_type: string
  http_status: number | null
  title: string | null
  h1_text: string | null
  word_count: number
  fact_density: number
  is_js_rendered: boolean
  page_score: number | null
  content_score: number | null
  structure_score: number | null
  schema_score: number | null
  schema_types: string[]
}

export type WebsiteAuditFindingOut = {
  id: number
  audit_id: number
  page_id: number | null
  check_id: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  category: 'bot_access' | 'content' | 'schema' | 'technical' | 'authority'
  message: string
  evidence: Record<string, unknown> | null
}

export type WebsiteAuditRecommendationOut = {
  id: number
  audit_id: number
  page_id: number | null
  priority: 'high' | 'medium' | 'low'
  effort: 'low' | 'medium' | 'high'
  category: string
  title: string
  body: string
  linked_prompt_ids: number[]
  expected_impact: string | null
  llm_generated: boolean
  artifact: string | null
  artifact_type: string | null
  artifact_generated_at: string | null
  artifact_regen_count: number
  status: 'pending' | 'applied' | 'dismissed'
  expected_lift_pp: number | null
  target_url: string | null
  priority_score: number | null
}

export type DraftArtifactResponse = {
  artifact: string
  artifact_type: string
  generated_at: string
  regen_count: number
}

export type CitationDomainAgg = { domain: string; kind: string; count: number }
export type CitationsOverview = {
  by_domain: CitationDomainAgg[]
  own_pct: number
  competitor_pct: number
  top_competitor_domains: CitationDomainAgg[]
}

export const siteAudit = {
  trigger: (brandId: number) =>
    api.post<{ audit_id: number; status: string }>(`/site-audit/${brandId}/trigger`).then(r => r.data),
  latest: (brandId: number) =>
    api.get<WebsiteAuditSummary>(`/site-audit/${brandId}/latest`).then(r => r.data),
  history: (brandId: number, limit = 10) =>
    api.get<WebsiteAuditSummary[]>(`/site-audit/${brandId}/history`, { params: { limit } }).then(r => r.data),
  audit: (auditId: number) =>
    api.get<WebsiteAuditSummary>(`/site-audit/audit/${auditId}`).then(r => r.data),
  pages: (auditId: number, opts?: { page?: number; per_page?: number; sort?: string }) =>
    api.get<WebsiteAuditPageOut[]>(`/site-audit/audit/${auditId}/pages`, { params: opts }).then(r => r.data),
  pageDetail: (auditId: number, pageId: number) =>
    api.get<{ page: WebsiteAuditPageOut; findings: WebsiteAuditFindingOut[]; recommendations: WebsiteAuditRecommendationOut[] }>(
      `/site-audit/audit/${auditId}/page/${pageId}`,
    ).then(r => r.data),
  findings: (auditId: number, severity?: string) =>
    api.get<WebsiteAuditFindingOut[]>(`/site-audit/audit/${auditId}/findings`, { params: { severity } }).then(r => r.data),
  recommendations: (auditId: number, priority?: string) =>
    api.get<WebsiteAuditRecommendationOut[]>(`/site-audit/audit/${auditId}/recommendations`, { params: { priority } }).then(r => r.data),
  citations: (brandId: number, days = 30) =>
    api.get<CitationsOverview>(`/site-audit/${brandId}/citations`, { params: { days } }).then(r => r.data),
  llmsTxt: (brandId: number) =>
    api.get<string>(`/site-audit/${brandId}/llms-txt`, { responseType: 'text' }).then(r => r.data),
  robotsSnippet: (brandId: number, mode: 'allow_all' | 'search_only' = 'allow_all') =>
    api.get<string>(`/site-audit/${brandId}/robots-snippet`, {
      params: { mode }, responseType: 'text',
    }).then(r => r.data),
  draftRec: (recId: number, body?: { regenerate_notes?: string }) =>
    api.post<DraftArtifactResponse>(
      `/site-audit/recommendation/${recId}/draft`,
      body ?? {},
    ).then(r => r.data),
  setRecStatus: (recId: number, status: 'pending' | 'applied' | 'dismissed') =>
    api.patch(`/site-audit/recommendation/${recId}/status`, { status }),
  cancel: (auditId: number) =>
    api.post(`/site-audit/audit/${auditId}/cancel`),
  downloadPdf: (auditId: number) =>
    api.get(`/site-audit/audit/${auditId}/pdf`, { responseType: 'blob' }).then(r => r.data as Blob),
}

// ── Agency staff (sub-project B, 2026-05-12) ─────────────────────────────────

export interface AgencyStaffMember {
  id: number;
  name: string | null;
  email: string;
}

export async function agencyStaff(): Promise<AgencyStaffMember[]> {
  const res = await api.get<AgencyStaffMember[]>('/agency/staff');
  return res.data;
}

// ── Agency documents (sub-project C, 2026-05-12) ─────────────────────────────

export interface DocumentTemplate {
  kind: string;
  name: string;
  description: string;
}

export interface AgencyDocument {
  id: number;
  agency_client_id: number;
  kind: string;
  title: string;
  body_markdown: string;
  data_snapshot: string | null;
  generated_by_user_id: number | null;
  generated_by_name: string | null;
  generated_at: string;
  updated_at: string | null;
}

export async function agencyListDocumentTemplates(): Promise<DocumentTemplate[]> {
  const res = await api.get<DocumentTemplate[]>('/agency/document-templates');
  return res.data;
}

export async function agencyListDocuments(clientId: number, kind?: string): Promise<AgencyDocument[]> {
  const params: Record<string, string> = {};
  if (kind) params.kind = kind;
  const res = await api.get<AgencyDocument[]>(`/agency/clients/${clientId}/documents`, { params });
  return res.data;
}

export async function agencyUpdateDocument(documentId: number, bodyMarkdown: string): Promise<AgencyDocument> {
  const res = await api.patch<AgencyDocument>(`/agency/documents/${documentId}`, { body_markdown: bodyMarkdown });
  return res.data;
}

export async function agencyDeleteDocument(documentId: number): Promise<void> {
  await api.delete(`/agency/documents/${documentId}`);
}

export class MissingFieldsError extends Error {
  constructor(public missingFields: string[], message: string) {
    super(message);
    this.name = 'MissingFieldsError';
  }
}

export async function agencyRenderDocument(clientId: number, kind: string): Promise<{ blob: Blob; filename: string }> {
  try {
    const res = await api.post(`/agency/clients/${clientId}/documents/${kind}/render`, null, {
      responseType: 'blob',
    });
    const cd = res.headers['content-disposition'] as string | undefined;
    const match = cd && /filename="([^"]+)"/.exec(cd);
    const filename = match ? match[1] : `${kind}.pdf`;
    return { blob: res.data as Blob, filename };
  } catch (err) {
    // Axios with responseType:blob returns the error body as a Blob — parse it.
    const e = err as { response?: { status?: number; data?: Blob } };
    if (e.response?.data instanceof Blob) {
      const text = await e.response.data.text();
      try {
        const body = JSON.parse(text);
        if (e.response.status === 400 && body?.detail?.missing_fields) {
          throw new MissingFieldsError(body.detail.missing_fields, body.detail.detail || 'Missing brand fields');
        }
        if (body?.detail) {
          throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail));
        }
      } catch (parseErr) {
        if (parseErr instanceof MissingFieldsError) throw parseErr;
        // fall through
      }
    }
    throw err;
  }
}

// ── Per-client staff assignment (2026-05-20) ─────────────────────────────────

export interface ClientStaffAssignment {
  user_id: number;
  name: string | null;
  email: string;
  assigned_at: string;
}

export async function agencyListClientStaff(clientId: number): Promise<ClientStaffAssignment[]> {
  const res = await api.get<ClientStaffAssignment[]>(`/agency/clients/${clientId}/staff-assigned`);
  return res.data;
}

export async function agencyAssignStaff(clientId: number, userId: number): Promise<ClientStaffAssignment> {
  const res = await api.post<ClientStaffAssignment>(`/agency/clients/${clientId}/staff-assigned/${userId}`);
  return res.data;
}

export async function agencyUnassignStaff(clientId: number, userId: number): Promise<void> {
  await api.delete(`/agency/clients/${clientId}/staff-assigned/${userId}`);
}

// ----- Content Clusters -----

export interface ContentBrief {
  id: number;
  cluster_id: number;
  version: number;
  positioning: string;
  key_claims: string[];
  canonical_phrasings: string[];
  stats: { label: string; value: string; source: string }[];
  competitor_context: Record<string, unknown>;
  narrative_spine: string;
  tone_notes: string;
  created_by: string;
  created_at: string;
}

export interface ClusterPieceSummary {
  platform: string;
  draft_id: number | null;
  status: string;
  title: string | null;
  excerpt: string | null;
  low_evidence?: boolean;
}

export interface ContentClusterSummary {
  id: number;
  brand_id: number;
  prompt_id: number;
  prompt_text: string;
  status: string;
  pillar_mode: string;
  pillar_url: string | null;
  visibility_pct: number;
  pieces: ClusterPieceSummary[];
  version: number;
  last_generated_at: string | null;
  cluster_delta: number | null;
  posted_count: number;
  failure_reason?: string | null;
}

export interface ContentClusterDetail {
  id: number;
  brand_id: number;
  prompt_id: number;
  prompt_text: string;
  status: string;
  pillar_mode: string;
  pillar_url: string | null;
  visibility_pct: number;
  brief: ContentBrief | null;
  drafts: ContentDraft[];
  version: number;
  last_generated_at: string | null;
  cluster_delta: number | null;
  posted_count: number;
  angle: "auto" | "insider" | "neutral";
}

export interface PillarCandidate {
  page_id: number;
  url: string;
  title: string | null;
  tone_score: number;
  tone_reasoning: string;
}

export async function listClusters(brandId: number): Promise<ContentClusterSummary[]> {
  const res = await api.get<ContentClusterSummary[]>(`/clusters/${brandId}`);
  return res.data;
}

export async function getCluster(brandId: number, clusterId: number): Promise<ContentClusterDetail> {
  const res = await api.get<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}`);
  return res.data;
}

export async function regenerateClusterByPrompt(
  brandId: number,
  promptId: number,
): Promise<ContentClusterDetail> {
  const res = await api.post<ContentClusterDetail>(`/clusters/${brandId}/by-prompt/${promptId}/regenerate`);
  return res.data;
}

export async function regenerateClusterPiece(
  brandId: number,
  clusterId: number,
  platform: string,
): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(`/clusters/${brandId}/${clusterId}/regenerate-piece`, { platform });
  return res.data;
}

export async function editClusterBrief(
  brandId: number,
  clusterId: number,
  patch: Partial<Pick<ContentBrief, 'positioning' | 'key_claims' | 'canonical_phrasings' | 'stats' | 'narrative_spine' | 'tone_notes'>>,
): Promise<ContentBrief> {
  const res = await api.patch<ContentBrief>(`/clusters/${brandId}/${clusterId}/brief`, patch);
  return res.data;
}

export async function updateClusterAngle(
  brandId: number,
  clusterId: number,
  angle: "auto" | "insider" | "neutral",
): Promise<ContentClusterDetail> {
  const res = await api.patch<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}`, { angle });
  return res.data;
}

export async function proposeClusterPillar(brandId: number, clusterId: number): Promise<PillarCandidate | null> {
  const res = await api.post<PillarCandidate | null>(`/clusters/${brandId}/${clusterId}/pillar/propose`);
  return res.data;
}

export async function acceptClusterPillar(brandId: number, clusterId: number): Promise<ContentClusterDetail> {
  const res = await api.post<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}/pillar/accept`);
  return res.data;
}

export async function rejectClusterPillar(brandId: number, clusterId: number): Promise<ContentClusterDetail> {
  const res = await api.post<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}/pillar/reject`);
  return res.data;
}

// ── Cluster redesign (2026-05-20) ─────────────────────────────────────────────

export interface ClusterPieceStatus {
  platform: string;
  draft_id: number | null;
  status: string | null;
  generation_state: string;
  failure_reason: string | null;
}

export interface ClusterStatusPayload {
  status: string;
  failure_reason: string | null;
  pieces: ClusterPieceStatus[];
  version: number;
  last_generated_at: string | null;
}

export interface ClusterSourceItem {
  url: string;
  domain: string;
  tier: 'T1' | 'T2' | 'T3' | 'brand';
  title: string | null;
  times_cited: number;
}

export interface ClusterSourcesPayload {
  total_t1: number;
  total_t2: number;
  total_t3: number;
  sources: ClusterSourceItem[];
}

export async function getClusterStatus(
  brandId: number,
  clusterId: number,
): Promise<ClusterStatusPayload> {
  const res = await api.get<ClusterStatusPayload>(`/clusters/${brandId}/${clusterId}/status`);
  return res.data;
}

export async function regenerateClusterPieces(
  brandId: number,
  clusterId: number,
): Promise<ContentClusterDetail> {
  const res = await api.post<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}/regenerate-pieces`);
  return res.data;
}

export async function rebuildCluster(
  brandId: number,
  clusterId: number,
): Promise<ContentClusterDetail> {
  const res = await api.post<ContentClusterDetail>(`/clusters/${brandId}/${clusterId}/rebuild`);
  return res.data;
}

export async function getClusterSources(
  brandId: number,
  clusterId: number,
): Promise<ClusterSourcesPayload> {
  const res = await api.get<ClusterSourcesPayload>(`/clusters/${brandId}/${clusterId}/sources`);
  return res.data;
}

export async function getClusterBriefHistory(
  brandId: number,
  clusterId: number,
): Promise<ContentBrief[]> {
  const res = await api.get<ContentBrief[]>(`/clusters/${brandId}/${clusterId}/briefs`);
  return res.data;
}

// ── Agency drafting (sub-project E, 2026-05-13) ──────────────────────────────

export interface AgencyGenerateDraftIn {
  prompt_id: number;
  platform: string;
  custom_brief?: string;
}

export async function agencyGenerateDraft(
  clientId: number,
  body: AgencyGenerateDraftIn,
): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(
    `/agency/clients/${clientId}/drafts/generate`,
    body,
  );
  return res.data;
}

export async function agencyTriggerTracking(clientId: number): Promise<void> {
  await api.post(`/agency/clients/${clientId}/tracking/run`);
}

export async function agencyMarkDraftPosted(
  draftId: number,
  postUrl?: string,
): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(`/agency/drafts/${draftId}/mark-posted`, {
    post_url: postUrl ?? null,
  });
  return res.data;
}

// ----- Wikipedia Surface -----

export interface WikipediaScan {
  id: number;
  brand_id: number;
  status: 'running' | 'completed' | 'failed';
  triggered_by: number | null;
  prompts_searched: number;
  total_candidates_found: number;
  candidates_persisted: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface WikipediaCandidate {
  id: number;
  brand_id: number;
  prompt_id: number | null;
  scan_id: number;
  article_title: string;
  article_url: string;
  pageid: number;
  article_summary: string;
  legitimacy_score: number;
  legitimacy_reasoning: string;
  status: 'new' | 'drafted' | 'submitted' | 'accepted' | 'reverted' | 'dismissed';
  suggested_wikitext: string | null;
  suggested_section: string | null;
  suggested_insert_location: string | null;
  evidence_pack_used: Record<string, unknown> | null;
  last_drafted_at: string | null;
  last_status_change_at: string | null;
  created_at: string;
}

export type WikipediaCandidateStatusUpdate = 'submitted' | 'accepted' | 'reverted' | 'dismissed';

export async function listWikipediaCandidates(
  brandId: number,
  opts?: { status?: WikipediaCandidate['status']; minScore?: number },
): Promise<WikipediaCandidate[]> {
  const params: Record<string, string | number> = {};
  if (opts?.status) params.status = opts.status;
  if (opts?.minScore != null) params.min_score = opts.minScore;
  const res = await api.get<WikipediaCandidate[]>(`/wikipedia/${brandId}/candidates`, { params });
  return res.data;
}

export async function scanWikipedia(brandId: number): Promise<WikipediaScan> {
  const res = await api.post<WikipediaScan>(`/wikipedia/${brandId}/scan`);
  return res.data;
}

export async function getLatestWikipediaScan(brandId: number): Promise<WikipediaScan | null> {
  const res = await api.get<WikipediaScan | null>(`/wikipedia/${brandId}/scans/latest`);
  return res.data;
}

export async function draftWikipediaCandidate(brandId: number, candidateId: number): Promise<WikipediaCandidate> {
  const res = await api.post<WikipediaCandidate>(`/wikipedia/${brandId}/candidates/${candidateId}/draft`);
  return res.data;
}

export async function updateWikipediaCandidateStatus(
  brandId: number,
  candidateId: number,
  status: WikipediaCandidateStatusUpdate,
): Promise<WikipediaCandidate> {
  const res = await api.patch<WikipediaCandidate>(`/wikipedia/${brandId}/candidates/${candidateId}/status`, { status });
  return res.data;
}


// ── Prospect audits ──────────────────────────────────────────────────────────

export interface ProspectAuditCreate {
  business_name: string;
  website_url: string;
  is_local: boolean;
  location?: string | null;
  prompts?: string[] | null;
}

export interface ProspectPromptSuggestRequest {
  business_name: string;
  website_url: string;
  is_local: boolean;
  location?: string | null;
}

export interface ProspectAuditListItem {
  id: number;
  business_name: string;
  website_url: string;
  is_local: boolean;
  location: string | null;
  status: string;
  overall_visibility_pct: number | null;
  aggregate_rvi: number | null;
  rvi_band: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface ProspectAuditOut extends ProspectAuditListItem {
  status_message: string | null;
  error_message: string | null;
  cancel_requested: boolean;
  started_at: string | null;
  has_pdf: boolean;
}

export async function listProspectAudits(): Promise<ProspectAuditListItem[]> {
  const res = await api.get<ProspectAuditListItem[]>("/agency/prospects");
  return res.data;
}

export async function getProspectAudit(id: number): Promise<ProspectAuditOut> {
  const res = await api.get<ProspectAuditOut>(`/agency/prospects/${id}`);
  return res.data;
}

export async function createProspectAudit(payload: ProspectAuditCreate): Promise<ProspectAuditOut> {
  const res = await api.post<ProspectAuditOut>("/agency/prospects", payload);
  return res.data;
}

export async function suggestProspectPrompts(payload: ProspectPromptSuggestRequest): Promise<string[]> {
  const res = await api.post<{ prompts: string[] }>("/agency/prospects/suggest-prompts", payload);
  return res.data.prompts;
}

export async function cancelProspectAudit(id: number): Promise<void> {
  await api.post(`/agency/prospects/${id}/cancel`);
}

export async function retryProspectAudit(id: number): Promise<ProspectAuditOut> {
  const res = await api.post<ProspectAuditOut>(`/agency/prospects/${id}/retry`);
  return res.data;
}

export async function deleteProspectAudit(id: number): Promise<void> {
  await api.delete(`/agency/prospects/${id}`);
}

export function prospectAuditPdfUrl(id: number): string {
  const base = api.defaults.baseURL ?? "";
  return `${base}/agency/prospects/${id}/pdf`;
}

// ─── Client portal (token-gated, no auth) ───────────────────────────────────

export interface ClientPortalBrand {
  id: number;
  name: string;
  slug: string;
  brand_type: string;
  website_url: string | null;
}

export interface ClientPortalProposal {
  doc_url: string | null;
  label: string | null;
}

export interface ClientPortalDashboard {
  overall_score: number | null;
  latest_run_at: string | null;
  total_runs: number;
  sparkline: { completed_at: string | null; score: number | null }[];
}

const CLIENT_BASE = '/public/client';

export async function clientPortalGetBrand(token: string): Promise<ClientPortalBrand> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/brand`);
  return data;
}

export async function clientPortalGetProposal(token: string): Promise<ClientPortalProposal> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/proposal`);
  return data;
}

export async function clientPortalGetDashboard(token: string): Promise<ClientPortalDashboard> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/dashboard`);
  return data;
}

export async function clientPortalListRuns(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/runs`);
  return data;
}

export async function clientPortalListResponses(token: string, runId?: number): Promise<any[]> {
  const params = runId ? `?run_id=${runId}` : '';
  const { data } = await api.get(`${CLIENT_BASE}/${token}/responses${params}`);
  return data;
}

export async function clientPortalListCompetitors(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/competitors`);
  return data;
}

export async function clientPortalGetSiteAudit(token: string): Promise<any> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/site-audit`);
  return data;
}

export async function clientPortalListClusters(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/clusters`);
  return data;
}

export async function clientPortalListWikipedia(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/wikipedia`);
  return data;
}

export async function clientPortalListDocuments(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/documents`);
  return data;
}

export async function clientPortalGetDocument(token: string, docId: number): Promise<any> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/documents/${docId}`);
  return data;
}

export async function clientPortalListPostedContent(token: string): Promise<any[]> {
  const { data } = await api.get(`${CLIENT_BASE}/${token}/content`);
  return data;
}

export async function agencySetClientProposal(
  clientId: number,
  body: { current_proposal_doc_url: string | null; current_proposal_label: string | null },
): Promise<any> {
  const { data } = await api.patch(`/agency/clients/${clientId}/proposal`, body);
  return data;
}

// ── Agency milestones (2026-05-26 playbook redesign) ─────────────────────────

export type MilestoneKind =
  | 'kickoff'
  | 'sow'
  | 'initial_audit'
  | 'strategy_locked'
  | 'wikipedia_plan'
  | 'site_plan';

export type MilestoneStatus = 'not_started' | 'in_progress' | 'done' | 'skipped';

export interface AgencyClientMilestone {
  id: number;
  agency_client_id: number;
  kind: MilestoneKind;
  status: MilestoneStatus;
  started_at: string | null;
  target_at: string | null;
  completed_at: string | null;
  completed_by: number | null;
  completed_by_name: string | null;
  notes: string | null;
}

export interface AgencyClientMilestoneUpdate {
  status?: MilestoneStatus;
  started_at?: string | null;
  target_at?: string | null;
  notes?: string | null;
}

export async function agencyListMilestones(clientId: number): Promise<AgencyClientMilestone[]> {
  const res = await api.get<AgencyClientMilestone[]>(`/agency/clients/${clientId}/milestones`);
  return res.data;
}

export async function agencyUpdateMilestone(
  clientId: number,
  kind: MilestoneKind,
  body: AgencyClientMilestoneUpdate,
): Promise<AgencyClientMilestone> {
  const res = await api.patch<AgencyClientMilestone>(
    `/agency/clients/${clientId}/milestones/${kind}`,
    body,
  );
  return res.data;
}
