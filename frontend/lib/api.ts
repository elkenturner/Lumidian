import axios from 'axios';

const api = axios.create({
  baseURL: 'http://localhost:3001/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

export interface Brand {
  id: number;
  name: string;
  slug: string;
  tier: 'basic' | 'standard' | 'premium';
  prompt_count: number;
  created_at: string;
}

export interface Prompt {
  id: number;
  brand_id: number;
  text: string;
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

export interface AccountConnection {
  id: number;
  platform: 'reddit' | 'quora' | 'medium' | 'wikipedia';
  status: 'connected' | 'disconnected' | 'error';
  display_name: string | null;
  connected_at: string | null;
  last_verified_at: string | null;
  error_message: string | null;
}

export interface BrandContentSettings {
  id: number;
  brand_id: number;
  platform: string;
  enabled: boolean;
  drafting_frequency: 'daily' | 'every_3_days' | 'weekly' | 'manual';
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
  const res = await api.get<Brand[]>('/brands');
  return res.data;
}

export async function getBrand(id: number): Promise<BrandDetail> {
  const res = await api.get<BrandDetail>(`/brands/${id}`);
  return res.data;
}

export async function createBrand(data: {
  name: string;
  tier: string;
  prompts: string[];
}): Promise<BrandDetail> {
  const res = await api.post<BrandDetail>('/brands', data);
  return res.data;
}

export async function updateBrand(
  id: number,
  data: Partial<{ name: string; tier: string }>
): Promise<BrandDetail> {
  const res = await api.put<BrandDetail>(`/brands/${id}`, data);
  return res.data;
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
  data: { platform: string; prompt_id?: number; custom_brief?: string }
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

export async function generateNow(brandId: number, maxGaps = 3): Promise<ContentDraft[]> {
  const res = await api.post<ContentDraft[]>(`/content/${brandId}/generate-now`, { max_gaps: maxGaps });
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

// ── Account functions ────────────────────────────────────────────────────────

export async function getAccounts(): Promise<AccountConnection[]> {
  const res = await api.get<AccountConnection[]>('/accounts');
  return res.data;
}

export async function connectAccount(data: {
  platform: string;
  credentials: Record<string, string>;
}): Promise<AccountConnection> {
  const res = await api.post<AccountConnection>('/accounts/connect', data);
  return res.data;
}

export async function disconnectAccount(platform: string): Promise<void> {
  await api.delete(`/accounts/${platform}`);
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
  const res = await api.get<Competitor[]>(`/brands/${brandId}/competitors`);
  return res.data;
}

export async function addCompetitor(brandId: number, name: string): Promise<Competitor> {
  const res = await api.post<Competitor>(`/brands/${brandId}/competitors`, { name });
  return res.data;
}

export async function removeCompetitor(brandId: number, competitorId: number): Promise<void> {
  await api.delete(`/brands/${brandId}/competitors/${competitorId}`);
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

export interface DashboardAnalytics {
  brand_id: number;
  brand_name: string;
  sov: SOVData;
  sentiment: SentimentBreakdown;
  position: PositionData;
  top_domains: DomainStat[];
  recent_conversations: ConversationItem[];
  competitor_comparison: CompetitorStat[];
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

// ── Content Gap functions ─────────────────────────────────────────────────────

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
