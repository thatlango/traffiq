import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  Users, Navigation, AlertTriangle, Activity,
  Radio, TrendingUp, Shield, MapPin, RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";
import { format, parseISO } from "date-fns";

const AMBER = "#F59E0B";
const GREEN = "#10B981";
const BLUE = "#3B82F6";
const RED = "#EF4444";
const PURPLE = "#8B5CF6";
const ORANGE = "#F97316";

const MODE_COLORS: Record<string, string> = {
  car: BLUE, taxi: AMBER, bus: GREEN, truck: ORANGE,
  boda: RED, bicycle: PURPLE, walking: "#06B6D4",
};

function StatCard({ label, value, sub, icon: Icon, color, pulse }: {
  label: string; value: string | number; sub?: string;
  icon: any; color: string; pulse?: boolean;
}) {
  return (
    <div className="bg-card border border-card-border rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className="relative">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: color + "22" }}>
            <Icon size={18} style={{ color }} />
          </div>
          {pulse && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-card animate-pulse" />
          )}
        </div>
      </div>
      <div>
        <p className="text-3xl font-bold text-foreground">{value.toLocaleString()}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-card-border rounded-xl px-4 py-3 shadow-xl">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.value} {p.name}
        </p>
      ))}
    </div>
  );
};

export default function OverviewPage() {
  const stats = useQuery({ queryKey: ["overview"], queryFn: api.overview });
  const signups = useQuery({ queryKey: ["daily-signups"], queryFn: api.dailySignups });
  const journeys = useQuery({ queryKey: ["daily-journeys"], queryFn: api.dailyJourneys });
  const cities = useQuery({ queryKey: ["cities"], queryFn: api.signupsByCity });
  const modes = useQuery({ queryKey: ["modes"], queryFn: api.transportModes });

  const signupsData = (signups.data ?? []).map(d => ({
    day: format(parseISO(d.day), "MMM d"),
    signups: Number(d.count),
  }));
  const journeysData = (journeys.data ?? []).map(d => ({
    day: format(parseISO(d.day), "MMM d"),
    journeys: Number(d.count),
    score: Number(d.avg_score ?? 0),
  }));
  const modesData = (modes.data ?? []).map(d => ({
    name: d.mode.charAt(0).toUpperCase() + d.mode.slice(1),
    value: Number(d.count),
    color: MODE_COLORS[d.mode] ?? AMBER,
  }));

  const s = stats.data;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Overview</h2>
          <p className="text-sm text-muted-foreground mt-1">Real-time TraffIQ platform metrics</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw size={12} className={stats.isFetching ? "animate-spin" : ""} />
          Auto-refreshes every 30s
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Live Users" value={s?.liveUsers ?? 0} sub="Active now" icon={Radio} color={GREEN} pulse />
        <StatCard label="Total Users" value={s?.totalUsers ?? 0} sub="All time" icon={Users} color={AMBER} />
        <StatCard label="Active Today" value={s?.activeToday ?? 0} sub="Last 24 hours" icon={Activity} color={BLUE} />
        <StatCard label="Total Journeys" value={s?.totalJourneys ?? 0} sub="All time" icon={Navigation} color={PURPLE} />
        <StatCard label="New This Week" value={s?.newSignupsThisWeek ?? 0} sub="New signups" icon={TrendingUp} color={GREEN} />
        <StatCard label="Incidents" value={s?.totalIncidents ?? 0} sub="Total reported" icon={AlertTriangle} color={RED} />
        <StatCard label="Avg Safety Score" value={s?.averageSafetyScore ?? 0} sub="Platform average" icon={Shield} color={AMBER} />
        <StatCard label="Cities" value={(cities.data ?? []).length} sub="With users" icon={MapPin} color={BLUE} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily signups */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Daily Signups (Last 30 days)</h3>
          {signupsData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={signupsData}>
                <defs>
                  <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={AMBER} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="signups" name="Signups" stroke={AMBER} fill="url(#signupGrad)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Daily journeys */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Daily Journeys (Last 30 days)</h3>
          {journeysData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={journeysData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="journeys" name="Journeys" fill={BLUE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transport modes */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Transport Modes Used</h3>
          {modesData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No journey data yet</div>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={180} height={180}>
                <PieChart>
                  <Pie data={modesData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3}>
                    {modesData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-col gap-2">
                {modesData.map(m => (
                  <div key={m.name} className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: m.color }} />
                    <span className="text-xs text-muted-foreground">{m.name}</span>
                    <span className="text-xs font-semibold text-foreground ml-auto pl-4">{m.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Signups by city */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Signups by City</h3>
          <div className="space-y-3">
            {(cities.data ?? []).slice(0, 8).map((c, i) => {
              const max = Number((cities.data ?? [])[0]?.count ?? 1);
              const pct = Math.round((Number(c.count) / max) * 100);
              return (
                <div key={c.city} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-4">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between mb-1">
                      <span className="text-sm text-foreground font-medium">{c.city}</span>
                      <span className="text-xs text-muted-foreground">{c.count} users</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                </div>
              );
            })}
            {(cities.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No city data yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
