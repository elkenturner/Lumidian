import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// ── Request deduplication ─────────────────────────────────────────────────────
// Prevents duplicate concurrent GET requests for the same URL.
// If the same GET is fired twice before the first resolves, both callers share
// the same Promise. The entry is removed once the request settles.
const _inflight = new Map<string, Promise<any>>();

function dedupedGet<T>(url: string): Promise<T> {
  if (_inflight.has(url)) return _inflight.get(url) as Promise<T>;
  const p = api.get<T>(url).then((r) => r.data).finally(() => _inflight.delete(url));
  _inflight.set(url, p);
  return p;
}

export interface Brand {
  id: number;
  name: string;
  slug: string;
  tier: 'basic' | 'standard' | 'premium';
  brand_type: 'standard' | 'pitch';
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
  edited_count: number;
  time_to_approve_seconds: number | null;
  created_at: string;
  updated_at: string;
  prompt_text?: string;
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
  const res = await api.get<BrandDetail>(`/brands/${id}`);
  return res.data;
}

export async function createBrand(data: {
  name: string;
  tier: string;
  brand_type?: 'standard' | 'pitch';
  prompts: string[];
  website_url?: string;
}): Promise<BrandDetail> {
  const res = await api.post<BrandDetail>('/brands', data);
  return res.data;
}

export async function updateBrand(
  id: number,
  data: Partial<{ name: string; tier: string; website_url: string | null }>
): Promise<BrandDetail> {
  const res = await api.put<BrandDetail>(`/brands/${id}`, data);
  return res.data;
}

export async function refreshWebsiteContext(brandId: number): Promise<void> {
  await api.post(`/brands/${brandId}/refresh-website-context`);
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
}

export async function addPrompt(brandId: number, text: string): Promise<Prompt> {
  const res = await api.post<Prompt>(`/brands/${brandId}/prompts`, { text });
  return res.data;
}

export async function deletePrompt(brandId: number, promptId: number): Promise<void> {
  await api.delete(`/brands/${brandId}/prompts/${promptId}`);
}

export async function triggerRun(brandId: number): Promise<{ run_id: number }> {
  const res = await api.post<{ run_id: number }>(`/tracking/run/${brandId}`);
  return res.data;
}

export async function triggerPromptRun(brandId: number, promptId: number): Promise<{ run_id: number }> {
  const res = await api.post<{ run_id: number }>(`/tracking/run-prompt/${brandId}/${promptId}`);
  return res.data;
}

export async function getRunStatus(runId: number): Promise<TrackingRun> {
  const res = await api.get<TrackingRun>(`/tracking/run/${runId}/status`);
  return res.data;
}

export async function getRecentRuns(brandId: number): Promise<TrackingRun[]> {
  const res = await api.get<TrackingRun[]>(`/tracking/runs/${brandId}`);
  return res.data;
}

export async function getOverview(brandId: number): Promise<OverviewData> {
  const res = await api.get<OverviewData>(`/results/${brandId}/overview`);
  return res.data;
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
  const res = await api.get<TrendsApiResponse>(`/results/${brandId}/trends`);
  return (res.data.trend_data ?? []).map((p) => ({
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
  const res = await api.get<PaginatedQueryResults>(`/results/${brandId}/responses`, { params });
  return res.data.items;
}

// ── Content functions ────────────────────────────────────────────────────────

export async function getDrafts(
  brandId: number,
  platform?: string,
  status?: string
): Promise<ContentDraft[]> {
  const params: Record<string, string> = {};
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
  data: { title?: string; content_text?: string; status?: string }
): Promise<ContentDraft> {
  const res = await api.put<ContentDraft>(`/content/draft/${draftId}`, data);
  return res.data;
}

export async function postDraft(
  draftId: number,
  data: { post_url?: string }
): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(`/content/draft/${draftId}/post`, data);
  return res.data;
}

export async function deleteDraft(draftId: number): Promise<void> {
  await api.delete(`/content/draft/${draftId}`);
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

export async function generateNow(brandId: number, maxGaps = 20): Promise<ContentDraft[]> {
  const res = await api.post<ContentDraft[]>(`/content/${brandId}/generate-now`, { max_gaps: maxGaps });
  return res.data;
}

export interface DraftQueueStatus {
  draft_count: number;
  draft_cap: number;
  draft_queue_full: boolean;
  scheduled_count: number;
  scheduled_cap: number;
  scheduled_queue_full: boolean;
  last_scan_at: string | null;
}

export async function getDraftStatus(brandId: number): Promise<DraftQueueStatus> {
  const res = await api.get<DraftQueueStatus>(`/content/${brandId}/draft-status`);
  return res.data;
}

// ── Opportunity functions ────────────────────────────────────────────────────

export async function getOpportunities(brandId: number): Promise<ContentOpportunity[]> {
  const res = await api.get<ContentOpportunity[]>(`/opportunities/${brandId}`);
  return res.data;
}

export async function dismissOpportunity(opportunityId: number): Promise<void> {
  await api.delete(`/opportunities/${opportunityId}/dismiss`);
}

export async function draftOpportunity(opportunityId: number): Promise<ContentDraft> {
  const res = await api.post<ContentDraft>(`/opportunities/${opportunityId}/draft`);
  return res.data;
}

export async function triggerScan(brandId: number): Promise<{ message: string }> {
  const res = await api.post<{ message: string }>(`/opportunities/${brandId}/scan`);
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
  website_url?: string | null;
  created_at: string;
}

export async function getCompetitors(brandId: number): Promise<Competitor[]> {
  const res = await api.get<Competitor[]>(`/brands/${brandId}/competitors`);
  return res.data;
}

export async function addCompetitor(
  brandId: number,
  name: string,
  websiteUrl?: string,
): Promise<Competitor> {
  const res = await api.post<Competitor>(`/brands/${brandId}/competitors`, {
    name,
    website_url: websiteUrl || null,
  });
  return res.data;
}

export async function removeCompetitor(brandId: number, competitorId: number): Promise<void> {
  await api.delete(`/brands/${brandId}/competitors/${competitorId}`);
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
): Promise<string[]> {
  const res = await api.post<string[]>('/brands/suggest-prompts-preview', {
    name,
    description: description ?? '',
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
}

export async function getDashboardAnalytics(brandId: number): Promise<DashboardAnalytics> {
  const res = await api.get<DashboardAnalytics>(`/dashboard/${brandId}/analytics`);
  return res.data;
}

// ── Brand with stats (for brand switcher) ────────────────────────────────────

export interface BrandWithStats {
  id: number;
  name: string;
  slug: string;
  tier: 'basic' | 'standard' | 'premium';
  brand_type: 'standard' | 'pitch';
  pitch_expires_at: string | null;
  prompt_count: number;
  overall_score: number | null;
  last_run_at: string | null;
  trend: 'up' | 'down' | 'flat';
  created_at: string;
  updated_at: string;
}

export async function getBrandsWithStats(): Promise<BrandWithStats[]> {
  const res = await api.get<BrandWithStats[]>('/brands/with-stats');
  return res.data;
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
  target_audience: string | null;
  approved_language: string[];
  publications: Publication[];
  completion_pct: number;
  internal_brand_context: string | null;
  website_context_last_fetched: string | null;
  created_at: string;
  updated_at: string;
}

export async function getBrandProfile(brandId: number): Promise<BrandProfile> {
  const res = await api.get<BrandProfile>(`/brands/${brandId}/profile`);
  return res.data;
}

export async function updateBrandProfile(
  brandId: number,
  data: Partial<{
    company_description: string;
    key_stats: string[];
    tone_of_voice: string;
    what_not_to_say: string[];
    target_audience: string;
    approved_language: string[];
    publications: Publication[];
  }>
): Promise<BrandProfile> {
  const res = await api.put<BrandProfile>(`/brands/${brandId}/profile`, data);
  return res.data;
}

export interface AiFillProfileResult {
  company_description: string | null;
  target_audience: string | null;
  tone_of_voice: string | null;
  key_stats: string[];
}

export async function aiFillProfile(brandId: number): Promise<AiFillProfileResult> {
  const res = await api.post<AiFillProfileResult>(`/brands/${brandId}/profile/ai-fill`);
  return res.data;
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
  const res = await api.get<ContentGap[]>(`/gaps/${brandId}`);
  return res.data;
}

export async function getGapSummary(brandId: number): Promise<GapSummary> {
  const res = await api.get<GapSummary>(`/gaps/${brandId}/summary`);
  return res.data;
}

export async function refreshGaps(brandId: number): Promise<{ message: string; run_id: number }> {
  const res = await api.post(`/gaps/${brandId}/refresh`);
  return res.data;
}

// ── Auth types & functions ────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  subscription_tier: 'starter' | 'pro' | null;
  subscription_status: string | null;
  is_admin: boolean;
  prompt_limit: number;
  totp_enabled: boolean;
  created_at: string;
  is_team_member?: boolean;
  team_owner_name?: string | null;
  team_owner_email?: string | null;
}

export async function authRegister(data: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthUser> {
  const res = await api.post<AuthUser>('/auth/register', data);
  return res.data;
}

export interface LoginResult {
  requires_2fa: true;
  challenge_token: string;
}

export async function authLogin(email: string, password: string): Promise<AuthUser | LoginResult> {
  const res = await api.post<AuthUser | LoginResult>('/auth/login', { email, password });
  return res.data;
}

export async function authLogout(): Promise<void> {
  await api.post('/auth/logout');
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
  subscription_tier: 'starter' | 'pro' | null;
  subscription_status: string | null;
  subscription_trial_end: string | null;
  days_remaining: number | null;
  prompt_limit: number;
  brand_limits: { standard: number; pitch: number };
  is_admin: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
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
  const res = await api.get<AdminUser[]>('/analytics/admin/users');
  return res.data;
}

export async function adminGetRuns(): Promise<AdminRun[]> {
  const res = await api.get<AdminRun[]>('/analytics/admin/runs');
  return res.data;
}

export async function adminGetStats(): Promise<AdminStats> {
  const res = await api.get<AdminStats>('/analytics/admin/stats');
  return res.data;
}

export async function adminTriggerRun(brandId: number): Promise<{ run_id: number; status: string }> {
  const res = await api.post<{ run_id: number; status: string }>(`/analytics/admin/trigger-run/${brandId}`);
  return res.data;
}

export async function adminGetLogs(lines = 100): Promise<{ lines: string[]; exists: boolean }> {
  const res = await api.get<{ lines: string[]; exists: boolean }>(`/analytics/admin/logs?lines=${lines}`);
  return res.data;
}

export async function adminPauseUser(userId: number): Promise<{ user_id: number; is_paused: boolean; action: string }> {
  const res = await api.post<{ user_id: number; is_paused: boolean; action: string }>(`/analytics/admin/users/${userId}/pause`);
  return res.data;
}

export async function adminRemoveUser(userId: number): Promise<{ user_id: number; deleted: boolean }> {
  const res = await api.delete<{ user_id: number; deleted: boolean }>(`/analytics/admin/users/${userId}`);
  return res.data;
}

export async function exportReportPDF(brandId: number): Promise<void> {
  const res = await api.get(`/reports/${brandId}/export`, { responseType: 'blob' });
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
