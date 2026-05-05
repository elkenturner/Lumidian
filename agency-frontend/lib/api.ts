import axios, { type AxiosInstance } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const client: AxiosInstance = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  timeout: 30000,
});

client.interceptors.response.use(
  (resp) => resp,
  (err) => {
    if (err?.response?.status === 401 && typeof window !== 'undefined') {
      const apex = process.env.NEXT_PUBLIC_APEX_LOGIN_URL || 'http://localhost:3000/login';
      window.location.href = apex;
    }
    return Promise.reject(err);
  },
);

export interface AgencyUser {
  id: number;
  email: string;
  name: string | null;
  is_admin: boolean;
  email_verified: boolean;
}

export interface AgencyClientOut {
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

export interface AgencyClientCreateBody {
  name: string;
  status?: string;
  retainer_amount_usd?: number;
  peec_dashboard_url?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
}

export interface TodayDraft {
  draft_id: number;
  title: string | null;
  platform: string;
  client_id: number;
  client_name: string;
  assigned_to_user_id: number | null;
  created_at: string;
}

export interface TodayResponse {
  drafts_to_review: TodayDraft[];
  drafts_to_review_count: number;
  active_clients: number;
}

export const api = {
  me: () => client.get<AgencyUser>('/api/auth/me').then((r) => r.data),

  listClients: () => client.get<AgencyClientOut[]>('/api/agency/clients').then((r) => r.data),
  getClient: (id: number) => client.get<AgencyClientOut>(`/api/agency/clients/${id}`).then((r) => r.data),
  createClient: (body: AgencyClientCreateBody) =>
    client.post<AgencyClientOut>('/api/agency/clients', body).then((r) => r.data),
  updateClient: (id: number, body: Partial<AgencyClientCreateBody> & { status?: string }) =>
    client.patch<AgencyClientOut>(`/api/agency/clients/${id}`, body).then((r) => r.data),
  deleteClient: (id: number) => client.delete(`/api/agency/clients/${id}`).then(() => undefined),

  today: () => client.get<TodayResponse>('/api/agency/today').then((r) => r.data),

  assignDraft: (draftId: number, userId: number | null) =>
    client.patch(`/api/agency/drafts/${draftId}/assign`, { assigned_to_user_id: userId }),

  getBrand: (brandId: number) =>
    client.get(`/api/brands/${brandId}`).then((r) => r.data),
  getBrandProfile: (brandId: number) =>
    client.get(`/api/brands/${brandId}/profile`).then((r) => r.data),
  updateBrandProfile: (brandId: number, body: Record<string, unknown>) =>
    client.put(`/api/brands/${brandId}/profile`, body).then((r) => r.data),
  addPrompt: (brandId: number, text: string) =>
    client
      .post(`/api/brands/${brandId}/prompts`, { text, prompt_type: 'standard' })
      .then((r) => r.data),
  deletePrompt: (brandId: number, promptId: number) =>
    client.delete(`/api/brands/${brandId}/prompts/${promptId}`).then(() => undefined),
  listDrafts: (brandId: number) =>
    client.get(`/api/content/${brandId}/drafts`).then((r) => r.data),
};
