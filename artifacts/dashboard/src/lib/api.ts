const API_BASE = import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

async function patch<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export interface OverviewStats {
  totalUsers: number;
  activeToday: number;
  totalJourneys: number;
  totalIncidents: number;
  liveUsers: number;
  newSignupsThisWeek: number;
  averageSafetyScore: number;
}

export interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  device_platform: string;
  created_at: string;
  last_active: string;
  signup_city?: string;
  signup_country?: string;
  is_live: boolean;
}

export interface DailyPoint {
  day: string;
  count: number;
  avg_score?: number;
}

export interface CityRow {
  city: string;
  country: string;
  count: number;
  lat: number;
  lng: number;
}

export interface IncidentRow {
  id: string;
  type: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  confirmed: number;
  created_at: string;
  reporter_name?: string;
  device_platform?: string;
}

export interface IncidentPage {
  incidents: IncidentRow[];
  total: number;
}

export interface IncidentTypeStats {
  type: string;
  count: number;
  avg_confirmed: number;
}

export interface IncidentStats {
  byType: IncidentTypeStats[];
  daily: { day: string; count: number }[];
  summary: {
    total: number;
    avg_confirmed: number;
    with_location: number;
    verified: number;
    today: number;
  };
}

export interface ModeRow {
  mode: string;
  count: number;
}

export const api = {
  overview:       () => get<OverviewStats>("/analytics/overview"),
  users:          (limit = 50, offset = 0) => get<{ users: UserRow[]; total: number }>(`/analytics/users?limit=${limit}&offset=${offset}`),
  dailySignups:   () => get<DailyPoint[]>("/analytics/daily-signups"),
  dailyJourneys:  () => get<DailyPoint[]>("/analytics/daily-journeys"),
  signupsByCity:  () => get<CityRow[]>("/analytics/signups-by-city"),
  recentIncidents: () => get<IncidentRow[]>("/analytics/recent-incidents").then(r => Array.isArray(r) ? r : (r as any).incidents ?? []),
  incidents:      (params?: { limit?: number; offset?: number; type?: string; days?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit)  q.set("limit",  String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.type && params.type !== "all") q.set("type", params.type);
    if (params?.days)   q.set("days",   String(params.days));
    return get<IncidentPage>(`/analytics/recent-incidents?${q}`);
  },
  incidentStats:  () => get<IncidentStats>("/analytics/incidents-stats"),
  confirmIncident:(id: string) => patch<{ id: string; confirmed: number }>(`/incidents/${id}/confirm`),
  dismissIncident:(id: string) => patch<{ id: string; confirmed: number }>(`/incidents/${id}/dismiss`),
  transportModes: () => get<ModeRow[]>("/analytics/transport-modes"),
};
