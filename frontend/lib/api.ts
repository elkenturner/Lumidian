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
  const e = err as { response?: { status?: number; data?: { detail?: string } }; request?: unknown };
  const detail = e?.response?.data?.detail;
  if (detail) return detail;
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
    .then((r) => { _cache.set(key, { data: r.data, ts: Date.now() }); return r.data; })
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

export async function triggerPromptRun(brandId: number, promptId: number): Promise<{ run_id: number }> {
  const res = await api.post<{ run_id: number }>(`/tracking/run-prompt/${brandId}/${promptId}`);
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

export async function postDraft(
  draftId: number,
  data: { post_url?: string }
): Promise<{ id: number; draft_id: number; platform: string; post_url: string | null; posted_at: string | null }> {
  const res = await api.post(`/content/draft/${draftId}/post`, data);
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

export async function approveAllDrafts(
  brandId: number,
  platform?: string
): Promise<{ approved: number; skipped: number; reason: string | null }> {
  const params: Record<string, string> = {};
  if (platform && platform !== 'all') params.platform = platform;
  const res = await api.post(`/content/${brandId}/drafts/approve-all`, null, { params });
  invalidateCache('/content/');
  return res.data;
}

export async function getContentSettings(brandId: number): Promise<BrandContentSettings[]> {
  const res = await api.get<BrandContentSettings[]>(`/content/${brandId}/settings`);
  return res.data;
}

export async function updateContentSettings(
  brandId: number,
  platform: string,
  data: Partial<BrandContentSettings>
): Promise<BrandContentSettings> {
  const res = await api.put<BrandContentSettings>(
    `/content/${brandId}/settings/${platform}`,
    data
  );
  return res.data;
}

export async function getPlatformGuidelines(platform: string): Promise<PlatformGuidelines> {
  const res = await api.get<PlatformGuidelines>(`/content/guidelines/${platform}`);
  return res.data;
}

export async function getAttribution(brandId: number): Promise<ContentAttribution[]> {
  const res = await api.get<ContentAttribution[]>(`/content/${brandId}/attribution`);
  return res.data;
}

export async function generateNow(brandId: number, maxGaps = 20): Promise<void> {
  await api.post(`/content/${brandId}/generate-now`, { max_gaps: maxGaps });
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

export async function getDraftStatus(brandId: number): Promise<DraftQueueStatus> {
  return dedupedGet<DraftQueueStatus>(`/content/${brandId}/draft-status`);
}

/** Bypass cache — used during generation polling where fresh data is critical. */
export async function getDraftStatusFresh(brandId: number): Promise<DraftQueueStatus> {
  invalidateCache(`/content/${brandId}/draft-status`);
  const res = await api.get<DraftQueueStatus>(`/content/${brandId}/draft-status`);
  return res.data;
}

// ── Opportunity functions ────────────────────────────────────────────────────

export async function getOpportunities(brandId: number): Promise<ContentOpportunity[]> {
  return dedupedGet<ContentOpportunity[]>(`/opportunities/${brandId}`);
}

export async function dismissOpportunity(opportunityId: number): Promise<void> {
  await api.delete(`/opportunities/${opportunityId}/dismiss`);
  invalidateCache('/opportunities/');
}

export async function draftOpportunity(opportunityId: number): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(`/opportunities/${opportunityId}/draft`);
  invalidateCache('/opportunities/');
  return res.data;
}

export async function triggerScan(brandId: number): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>(`/opportunities/${brandId}/scan`);
  invalidateCache('/opportunities/');
  return res.data;
}

export async function getApiKeyStatus(): Promise<ApiKeyStatus> {
  const res = await api.get<ApiKeyStatus>('/settings/api-keys');
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

export async function getBrandsWithStats(): Promise<BrandWithStats[]> {
  return dedupedGet<BrandWithStats[]>('/brands/with-stats');
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

export async function getGapSummary(brandId: number): Promise<GapSummary> {
  return dedupedGet<GapSummary>(`/gaps/${brandId}/summary`);
}

export async function refreshGaps(brandId: number): Promise<{ message: string; run_id: number }> {
  const res = await api.post(`/gaps/${brandId}/refresh`);
  invalidateCache(`/gaps/${brandId}`);
  return res.data;
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
  peec_dashboard_url: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  brand_id: number | null;
  drafts_pending: number;
  created_at: string;
}

export interface AgencyClientCreate {
  name: string;
  status?: string;
  retainer_amount_usd?: number;
  peec_dashboard_url?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
}

export interface AgencyTodayDraft {
  draft_id: number;
  title: string | null;
  platform: string;
  client_id: number;
  client_name: string;
  assigned_to_user_id: number | null;
  created_at: string;
}

export interface AgencyTodayResponse {
  drafts_to_review: AgencyTodayDraft[];
  drafts_to_review_count: number;
  active_clients: number;
  awaiting_client: AgencyTodayDraft[];
  approved: AgencyTodayDraft[];
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

export async function agencyDeleteClient(id: number): Promise<void> {
  await api.delete(`/agency/clients/${id}`);
}

export async function agencyToday(): Promise<AgencyTodayResponse> {
  const res = await api.get<AgencyTodayResponse>('/agency/today');
  return res.data;
}

export async function agencyAssignDraft(draftId: number, userId: number | null): Promise<void> {
  await api.patch(`/agency/drafts/${draftId}/assign`, { assigned_to_user_id: userId });
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

export async function publicGetReviewPage(token: string): Promise<ReviewClientPage> {
  const res = await api.get<ReviewClientPage>(`/public/review/${token}`);
  return res.data;
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

export async function authGoogle(idToken: string): Promise<AuthUser> {
  const res = await api.post<AuthUser>('/auth/google', { id_token: idToken });
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

export async function getInviteInfo(token: string): Promise<InviteInfo> {
  const res = await api.get<InviteInfo>(`/team/accept-info?token=${token}`);
  return res.data;
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

export async function markNotificationRead(id: number): Promise<AppNotification> {
  const res = await api.post<AppNotification>(`/notifications/${id}/read`);
  return res.data;
}

// ── Quora question search ──────────────────────────────────────────────────────

export async function getQuoraQuestions(
  brandId: number,
  promptId: number
): Promise<QuoraQuestion[]> {
  const res = await api.get<{ questions: QuoraQuestion[] }>(
    `/brands/${brandId}/quora-questions`,
    { params: { prompt_id: promptId } }
  );
  return res.data.questions;
}

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

export async function setup2fa(): Promise<TotpSetupData> {
  const res = await api.post<TotpSetupData>('/auth/2fa/setup');
  return res.data;
}

export async function enable2fa(code: string): Promise<void> {
  await api.post('/auth/2fa/enable', { code });
}

export async function disable2fa(password: string): Promise<void> {
  await api.post('/auth/2fa/disable', { password });
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

export async function getPromptTimeline(brandId: number, promptId: number, days?: number): Promise<PromptTimelineData> {
  const params = days ? { days } : undefined;
  return dedupedGet<PromptTimelineData>(`/results/${brandId}/prompt/${promptId}/timeline`, params);
}

export async function getPromptDetail(brandId: number, promptId: number): Promise<PromptDetailData> {
  return dedupedGet<PromptDetailData>(`/results/${brandId}/prompt/${promptId}/detail`);
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
  cancel: (auditId: number) =>
    api.post(`/site-audit/audit/${auditId}/cancel`),
}

// ── Agency activity log (2026-05-12) ─────────────────────────────────────────

export type ActivityEventType =
  | 'note'
  | 'client_created'
  | 'client_status_changed'
  | 'draft_sent_to_client'
  | 'draft_marked_posted'
  | 'review_link_generated'
  | 'review_link_rotated'
  | 'client_approved'
  | 'client_changes_requested'
  | 'client_rejected';

export interface ActivityEvent {
  id: number;
  agency_client_id: number;
  event_type: ActivityEventType | string;
  actor_user_id: number | null;
  actor_name: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  related_draft_id: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface ActivityEventWithClient extends ActivityEvent {
  client_id: number;
  client_name: string;
}

export async function agencyListActivity(
  clientId: number,
  opts: { limit?: number; before?: number } = {},
): Promise<ActivityEvent[]> {
  const params: Record<string, number> = {};
  if (opts.limit !== undefined) params.limit = opts.limit;
  if (opts.before !== undefined) params.before = opts.before;
  const res = await api.get<ActivityEvent[]>(`/agency/clients/${clientId}/activity`, { params });
  return res.data;
}

export async function agencyPostNote(clientId: number, body: string): Promise<ActivityEvent> {
  const res = await api.post<ActivityEvent>(`/agency/clients/${clientId}/activity/note`, { body });
  return res.data;
}

export async function agencyEditNote(eventId: number, body: string): Promise<ActivityEvent> {
  const res = await api.patch<ActivityEvent>(`/agency/activity/${eventId}/note`, { body });
  return res.data;
}

export async function agencyDeleteNote(eventId: number): Promise<void> {
  await api.delete(`/agency/activity/${eventId}/note`);
}

export async function agencyRecentActivity(limit = 10): Promise<ActivityEventWithClient[]> {
  const res = await api.get<ActivityEventWithClient[]>(`/agency/activity/recent`, {
    params: { limit },
  });
  return res.data;
}

// ── Agency tasks (sub-project B, 2026-05-12) ─────────────────────────────────

export type TaskStatus = 'open' | 'in_progress' | 'done';

export interface AgencyTask {
  id: number;
  agency_client_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigned_to_user_id: number | null;
  assigned_to_name: string | null;
  due_at: string | null;
  created_by_user_id: number | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

export interface AgencyTaskCreate {
  title: string;
  description?: string;
  due_at?: string;
  assigned_to_user_id?: number | null;
}

export interface AgencyTaskUpdate {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  due_at?: string | null;
  assigned_to_user_id?: number | null;
}

export interface AgencyStaffMember {
  id: number;
  name: string | null;
  email: string;
}

export interface MyQueueDraft {
  draft_id: number;
  title: string | null;
  platform: string;
  status: string;
  client_id: number;
  client_name: string;
  created_at: string;
}

export interface MyQueueResponse {
  drafts: MyQueueDraft[];
  tasks: AgencyTask[];
}

export async function agencyListTasks(clientId: number, status?: TaskStatus): Promise<AgencyTask[]> {
  const params: Record<string, string> = {};
  if (status) params.status = status;
  const res = await api.get<AgencyTask[]>(`/agency/clients/${clientId}/tasks`, { params });
  return res.data;
}

export async function agencyCreateTask(clientId: number, body: AgencyTaskCreate): Promise<AgencyTask> {
  const res = await api.post<AgencyTask>(`/agency/clients/${clientId}/tasks`, body);
  return res.data;
}

export async function agencyUpdateTask(taskId: number, body: AgencyTaskUpdate): Promise<AgencyTask> {
  const res = await api.patch<AgencyTask>(`/agency/tasks/${taskId}`, body);
  return res.data;
}

export async function agencyDeleteTask(taskId: number): Promise<void> {
  await api.delete(`/agency/tasks/${taskId}`);
}

export async function agencyMyQueue(): Promise<MyQueueResponse> {
  const res = await api.get<MyQueueResponse>('/agency/my-queue');
  return res.data;
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
  generated_by_user_id: number | null;
  generated_by_name: string | null;
  generated_at: string;
  updated_at: string | null;
}

export interface AgencyDocumentWithClient extends AgencyDocument {
  client_id: number;
  client_name: string;
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

export async function agencyGetDocument(documentId: number): Promise<AgencyDocument> {
  const res = await api.get<AgencyDocument>(`/agency/documents/${documentId}`);
  return res.data;
}

export async function agencyGenerateDocument(clientId: number, kind: string): Promise<AgencyDocument> {
  const res = await api.post<AgencyDocument>(`/agency/clients/${clientId}/documents`, { kind });
  return res.data;
}

export async function agencyUpdateDocument(documentId: number, bodyMarkdown: string): Promise<AgencyDocument> {
  const res = await api.patch<AgencyDocument>(`/agency/documents/${documentId}`, { body_markdown: bodyMarkdown });
  return res.data;
}

export async function agencyDeleteDocument(documentId: number): Promise<void> {
  await api.delete(`/agency/documents/${documentId}`);
}

export async function agencyRecentDocuments(limit = 20, kind?: string): Promise<AgencyDocumentWithClient[]> {
  const params: Record<string, string | number> = { limit };
  if (kind) params.kind = kind;
  const res = await api.get<AgencyDocumentWithClient[]>('/agency/documents/recent', { params });
  return res.data;
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
