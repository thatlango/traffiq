const API_BASE = import.meta.env.VITE_API_URL ?? `${window.location.origin}/api`;

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
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

export interface ModeRow {
  mode: string;
  count: number;
}

export const api = {
  overview: () => get<OverviewStats>("/analytics/overview"),
  users: (limit = 50, offset = 0) => get<{ users: UserRow[]; total: number }>(`/analytics/users?limit=${limit}&offset=${offset}`),
  dailySignups: () => get<DailyPoint[]>("/analytics/daily-signups"),
  dailyJourneys: () => get<DailyPoint[]>("/analytics/daily-journeys"),
  signupsByCity: () => get<CityRow[]>("/analytics/signups-by-city"),
  recentIncidents: () => get<IncidentRow[]>("/analytics/recent-incidents"),
  transportModes: () => get<ModeRow[]>("/analytics/transport-modes"),
};
